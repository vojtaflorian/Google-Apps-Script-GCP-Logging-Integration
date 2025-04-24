// infoLog skript:
// https://script.google.com/home/projects/1G3kQYfGae1-tE2vCH9_vUh_7k7_sMqJme9Z2ATfJgDueVeUPORU7Qkvn/edit
// SKRIPT ID 1G3kQYfGae1-tE2vCH9_vUh_7k7_sMqJme9Z2ATfJgDueVeUPORU7Qkvn
// OAUTH ID 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
// logy: https://console.cloud.google.com/logs/

// Konstanty definované mimo funkci pro lepší výkon
var RESOURCE = { "type": "global" };

// Proměnné pro batch logování
var logQueue = [];
var MAX_QUEUE_SIZE = 3; // Sníženo na 3, aby se logy posílaly častěji
var lastFlushTime = new Date().getTime();
var FLUSH_INTERVAL_MS = 5000; // Sníženo na 5 sekund
// Globální proměnná pro sledování, jestli je Toast zobrazován
var lastToastTime = 0;
var TOAST_COOLDOWN_MS = 1000; // 1 sekunda mezi zobrazením Toast zpráv

// Token cache
var cachedToken = null;
var tokenExpiry = null;

// Trigger pro automatické odesílání logů
function setupTrigger() {
  // Odstraníme existující trigger, pokud existuje
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoFlushLogs') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Vytvoříme nový trigger, který bude spouštět autoFlushLogs každou minutu
  ScriptApp.newTrigger('autoFlushLogs')
    .timeBased()
    .everyMinutes(1)
    .create();
}

// Automatický flush logů volaný z triggeru
function autoFlushLogs() {
  if (logQueue.length > 0) {
    flushLogs();
  }
}

// Funkce writeLog zůstává téměř stejná
function writeLog(message) {
  try {
    var doc = null;
    var documentName = "N/A";
    var documentUrl = "N/A";
    
    try {
      doc = SpreadsheetApp.getActiveSpreadsheet();
      if (doc) {
        documentName = doc.getName();
        documentUrl = doc.getUrl();
      }
    } catch (docError) {
      // Ignorujeme chyby při získávání dokumentu
    }
    
    var userEmail = "N/A";
    try {
      userEmail = Session.getActiveUser().getEmail() || "N/A";
    } catch (emailError) {
      // Ignorujeme chyby při získávání emailu
    }
    
    var functionName = getCallerFunctionName();
    var logData = {
      message: message,
      documentName: documentName,
      documentUrl: documentUrl,
      userEmail: userEmail,
      functionName: functionName,
      timestamp: new Date().toISOString() // Přidáno pro lepší debugování
    };
    
    var severity = 'INFO';
    var messageLower = message.toLowerCase();
    if (messageLower.includes('chyba') || messageLower.includes('error')) {
      severity = 'ERROR';
    } else if (messageLower.includes('warning') || messageLower.includes('varování')) {
      severity = 'WARNING';
    }
    
    // Zobrazení Toast zprávy uživateli
    showToastMessage(message, severity);
    
    // Přidání do fronty
    logQueue.push({
      "logName": getLogName(),
      "resource": RESOURCE,
      "jsonPayload": logData,
      "severity": severity,
      "timestamp": new Date().toISOString()
    });
    
    // DŮLEŽITÁ ZMĚNA: Vždy flush po přidání zprávy
    // Toto zajistí, že logy jsou odeslány téměř okamžitě
    flushLogs();
    
  } catch (e) {
    Logger.log("Kritická chyba v writeLog: " + e.toString());
    // Zde by mohl být fallback pro zápis do SpreadsheetApp.getActiveSpreadsheet() do buňky
  }
}

// Zbytek funkcí zůstává stejný, ale přidáme sync flag
var isFlushingLogs = false;

function flushLogs() {
  if (logQueue.length === 0 || isFlushingLogs) return;
  
  isFlushingLogs = true;
  try {
    var accessToken = getAccessToken();
    var url = 'https://logging.googleapis.com/v2/entries:write';
    
    // Vytvoříme kopii fronty a resetujeme originál
    var queueToSend = logQueue.slice();
    logQueue = [];
    lastFlushTime = new Date().getTime();
    
    var payload = {
      "entries": queueToSend
    };
    
    var options = {
      'method': 'post',
      'contentType': 'application/json',
      'headers': {
        'Authorization': 'Bearer ' + accessToken
      },
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      Logger.log('infoLog: Error logging to GCP: ' + response.getContentText());
      Logger.log('Response code: ' + responseCode);
    }
  } catch (e) {
    Logger.log('infoLog: Exception during log flush: ' + e.toString());
  } finally {
    isFlushingLogs = false;
  }
}

/**
 * Vynucené odeslání všech logů - užitečné volat na konci skriptu.
 */
function forceLogs() {
  flushLogs();
}

/**
 * Získá název logu z nastavení projektu.
 */
function getLogName() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    return scriptProperties.getProperty('LOG_NAME');
  } catch (e) {
    Logger.log("Nelze získat LOG_NAME: " + e.toString());
    return "defaultLog";
  }
}

/**
 * Získá klíč služebního účtu z nastavení projektu.
 */
function getServiceAccountKey() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    var keyString = scriptProperties.getProperty('SERVICE_ACCOUNT_KEY');
    return JSON.parse(keyString);
  } catch (e) {
    Logger.log("Nelze získat nebo parsovat SERVICE_ACCOUNT_KEY: " + e.toString());
    throw e; // Tato chyba je kritická, nemůžeme pokračovat
  }
}

/**
 * Vytvoří OAuth2 službu pro autentizaci.
 */
function getOAuthService() {
  try {
    var key = getServiceAccountKey();
    
    return OAuth2.createService('GCPLogging')
      .setTokenUrl('https://oauth2.googleapis.com/token')
      .setPrivateKey(key.private_key)
      .setIssuer(key.client_email)
      .setPropertyStore(PropertiesService.getScriptProperties())
      .setScope('https://www.googleapis.com/auth/logging.write');
  } catch (e) {
    Logger.log("Nelze vytvořit OAuth službu: " + e.toString());
    throw e; // Tato chyba je kritická, nemůžeme pokračovat
  }
}

/**
 * Získá přístupový token pro Google Cloud API.
 */
function getAccessToken() {
  try {
    // Použít existující token, pokud není expirovaný
    var now = new Date().getTime();
    if (cachedToken && tokenExpiry && now < tokenExpiry) {
      return cachedToken;
    }
    
    var service = getOAuthService();
    if (service.hasAccess()) {
      cachedToken = service.getAccessToken();
      // Token typicky vyprší za 1 hodinu, nastavme expiraci na 50 minut pro jistotu
      tokenExpiry = now + (50 * 60 * 1000);
      return cachedToken;
    } else {
      Logger.log('Chyba při získávání Access Token: ' + service.getLastError());
      throw new Error('Failed to authenticate.');
    }
  } catch (e) {
    Logger.log("Kritická chyba v getAccessToken: " + e.toString());
    throw e; // Tato chyba je kritická, nemůžeme pokračovat
  }
}

/**
 * Zjistí název volající funkce z call stacku.
 */
function getCallerFunctionName() {
  try {
    var e = new Error();
    var stack = e.stack.toString().split('\n');
    // První řádek je chyba, druhý je tato funkce, třetí je writeLog, čtvrtý je volající funkce
    if (stack.length >= 5) {
      var callerLine = stack[4];
      var match = callerLine.match(/at\s+([\w$.]+)/);
      return match ? match[1] : 'unknown';
    } else {
      return 'unknown';
    }
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Zobrazí zprávu uživateli pomocí Toast notifikace.
 * Součást writeLog funkce pro okamžitou zpětnou vazbu.
 * @param {string} message Zpráva k zobrazení
 * @param {string} severity Závažnost zprávy (INFO, WARNING, ERROR)
 */
function showToastMessage(message, severity) {
  try {
    var now = new Date().getTime();
    // Omezení frekvence zobrazování Toast zpráv, aby nedocházelo k přetížení UI
    if (now - lastToastTime > TOAST_COOLDOWN_MS) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        // Nastavení titulku a doby zobrazení podle závažnosti
        var title = "Info";
        var duration = 5; // sekundy
        
        if (severity === 'WARNING') {
          title = "⚠️ Varování";
          duration = 7;
        } else if (severity === 'ERROR') {
          title = "❌ Chyba";
          duration = 10;
        }
        
        // Zobrazení Toast zprávy
        ss.toast(message, title, duration);
        lastToastTime = now;
      }
    }
  } catch (e) {
    // Tiché selhání - pokud nelze zobrazit Toast, nechceme přerušit logování
    Logger.log("Nelze zobrazit Toast: " + e.toString());
  }
}

/**
 * Testovací funkce pro ověření, že logování funguje.
 */
function testLogging() {
  Logger.log("Začátek testu logování");
  
  writeLog("Test zpráva 1");
  writeLog("Test zpráva s varováním");
  writeLog("Test zpráva s chybou");
  
  // Explicitní flush
  forceLogs();
  
  Logger.log("Test logování dokončen");
}
