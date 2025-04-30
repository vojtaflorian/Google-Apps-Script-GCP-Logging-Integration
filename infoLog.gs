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
var TOAST_COOLDOWN_MS = 250; // 1 sekunda mezi zobrazením Toast zpráv

// Token cache
var cachedToken = null;
var tokenExpiry = null;

// Log úrovně v pořadí dle závažnosti (od nejnižší po nejvyšší)
var LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4
};
/**
 * HLAVNÍ PROMĚNNÁ PRO ÚROVEŇ LOGOVÁNÍ!
 * Pokud byste někdy potřeboval dočasně vidět i DEBUG logy během ladění konkrétní funkce, můžete použít:
javascriptinfoLog.withLogLevel(function() {
  infoLog.logDebug("Detailní informace pro ladění");
  // další kód...
}, 'DEBUG');
Tento kód dočasně sníží úroveň logování pro daný blok kódu a poté ji vrátí zpět na WARNING.
 */
// Výchozí úroveň pro logování - vše nad touto úrovní bude zaznamenáno
var currentLogLevel = LOG_LEVELS.DEBUG; // Výchozí hodnota je INFO

/**
 * Nastaví minimální úroveň logování.
 * Logy s nižší úrovní nebudou odeslány do GCP.
 * 
 * @param {string} levelName - Název úrovně ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')
 * @returns {boolean} - Úspěch nastavení
 */
function setLogLevel(levelName) {
  try {
    levelName = levelName.toUpperCase();
    if (LOG_LEVELS.hasOwnProperty(levelName)) {
      currentLogLevel = LOG_LEVELS[levelName];
      writeLog("Úroveň logování nastavena na: " + levelName, LOG_LEVELS.INFO, true);
      return true;
    } else {
      writeLog("Neplatná úroveň logování: " + levelName, LOG_LEVELS.ERROR, true);
      return false;
    }
  } catch (e) {
    Logger.log("Chyba při nastavení úrovně logování: " + e.toString());
    return false;
  }
}

/**
 * Vrátí aktuální název úrovně logování
 * 
 * @returns {string} - Název aktuální úrovně
 */
function getLogLevelName() {
  for (var key in LOG_LEVELS) {
    if (LOG_LEVELS[key] === currentLogLevel) {
      return key;
    }
  }
  return "UNKNOWN";
}

/**
 * Hlavní logovací funkce - všechny ostatní metody volají tuto.
 * Zpětně kompatibilní s původním voláním.
 * 
 * @param {string} message - Zpráva k zalogování
 * @param {number} [level=LOG_LEVELS.INFO] - Úroveň závažnosti logu
 * @param {boolean} [forceLog=false] - Ignorovat filtrování dle úrovně
 */
function writeLog(message, level, forceLog) {
  // Zpětná kompatibilita - odhadnutí úrovně z textu zprávy
  if (level === undefined) {
    level = LOG_LEVELS.INFO;
    var messageLower = message.toLowerCase();
    if (messageLower.includes('chyba') || messageLower.includes('error')) {
      level = LOG_LEVELS.ERROR;
    } else if (messageLower.includes('warning') || messageLower.includes('varování')) {
      level = LOG_LEVELS.WARNING;
    }
  }
  
  // Filtrace dle úrovně logování
  if (!forceLog && level < currentLogLevel) {
    return; // Přeskočí zprávy s nižší prioritou než je nastaveno
  }

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
      timestamp: new Date().toISOString(),
      logLevel: getLogLevelName() // Přidána informace o úrovni
    };
    
    // Převod úrovně na textovou reprezentaci pro GCP
    var severity;
    switch(level) {
      case LOG_LEVELS.DEBUG:
        severity = 'DEBUG';
        break;
      case LOG_LEVELS.INFO:
        severity = 'INFO';
        break;
      case LOG_LEVELS.WARNING:
        severity = 'WARNING';
        break;
      case LOG_LEVELS.ERROR:
        severity = 'ERROR';
        break;
      case LOG_LEVELS.CRITICAL:
        severity = 'CRITICAL';
        break;
      default:
        severity = 'DEFAULT';
    }
    
    // Zobrazení Toast zprávy uživateli (jen pro INFO a vyšší)
    if (level >= LOG_LEVELS.INFO) {
      showToastMessage(message, severity);
    }
    
    // Přidání do fronty
    logQueue.push({
      "logName": getLogName(),
      "resource": RESOURCE,
      "jsonPayload": logData,
      "severity": severity,
      "timestamp": new Date().toISOString()
    });
    
    // Vždy flush po přidání zprávy
    flushLogs();
    
  } catch (e) {
    Logger.log("Kritická chyba v writeLog: " + e.toString());
  }
}

/**
 * Logovací metoda pro úroveň DEBUG
 * @param {string} message - Zpráva k zalogování
 */
function writeLogDebug(message) {
  writeLog(message, LOG_LEVELS.DEBUG);
}

/**
 * Logovací metoda pro úroveň INFO
 * @param {string} message - Zpráva k zalogování
 */
function writeLogInfo(message) {
  writeLog(message, LOG_LEVELS.INFO);
}

/**
 * Logovací metoda pro úroveň WARNING
 * @param {string} message - Zpráva k zalogování
 */
function writeLogWarning(message) {
  writeLog(message, LOG_LEVELS.WARNING);
}

/**
 * Logovací metoda pro úroveň ERROR
 * @param {string} message - Zpráva k zalogování
 */
function writeLogError(message) {
  writeLog(message, LOG_LEVELS.ERROR);
}

/**
 * Logovací metoda pro úroveň CRITICAL
 * @param {string} message - Zpráva k zalogování
 */
function writeLogCritical(message) {
  writeLog(message, LOG_LEVELS.CRITICAL);
}

// Alias metody pro jednoduchost
var logDebug = writeLogDebug;
var logInfo = writeLogInfo;
var logWarning = writeLogWarning;
var logError = writeLogError;
var logCritical = writeLogCritical;

// Zbytek funkcí zůstává stejný, ale přidáme sync flag
var isFlushingLogs = false;

/**
 * Odešle všechny zprávy z fronty do Google Cloud Logging.
 */
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
 * @returns {string} Název logu nebo "defaultLog" v případě chyby
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
 * @returns {Object} Klíč služebního účtu jako objekt
 * @throws {Error} Pokud klíč není k dispozici nebo není validní
 */
function getServiceAccountKey() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    var keyString = scriptProperties.getProperty('SERVICE_ACCOUNT_KEY');
    if (!keyString) {
      throw new Error("SERVICE_ACCOUNT_KEY není nastaven v PropertiesService");
    }
    return JSON.parse(keyString);
  } catch (e) {
    Logger.log("Nelze získat nebo parsovat SERVICE_ACCOUNT_KEY: " + e.toString());
    throw e; // Tato chyba je kritická, nemůžeme pokračovat
  }
}

/**
 * Vytvoří OAuth2 službu pro autentizaci.
 * @returns {OAuth2.Service} OAuth2 služba pro přístup ke Google Cloud API
 * @throws {Error} Pokud se službu nepodaří vytvořit
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
 * @returns {string} Access token pro volání Google Cloud API
 * @throws {Error} Pokud se token nepodaří získat
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
 * @returns {string} Název volající funkce nebo "unknown" v případě chyby
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
 * 
 * @param {string} message - Zpráva k zobrazení
 * @param {string} severity - Závažnost zprávy ('INFO', 'WARNING', 'ERROR', 'CRITICAL')
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
        } else if (severity === 'CRITICAL') {
          title = "🚨 KRITICKÁ CHYBA";
          duration = 15;
        } else if (severity === 'DEBUG') {
          title = "🔍 Debug";
          duration = 3;
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
 * Trigger pro automatické odesílání logů
 */
function setupTrigger() {
  try {
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
      
    Logger.log("Trigger pro autoFlushLogs úspěšně nastaven");
    return true;
  } catch (e) {
    Logger.log("Chyba při nastavování triggeru: " + e.toString());
    return false;
  }
}

/**
 * Automatický flush logů volaný z triggeru
 */
function autoFlushLogs() {
  if (logQueue.length > 0) {
    flushLogs();
  }
}

/**
 * Dočasně zvýší úroveň logování pro spuštění určité funkce.
 * Po dokončení funkce vrátí původní úroveň logování.
 * 
 * @param {function} func - Funkce, která se má spustit s vyšší úrovní logování
 * @param {string} level - Dočasná úroveň logování ('DEBUG', 'INFO', ...)
 * @returns {*} - Návratová hodnota funkce
 */
function withLogLevel(func, level) {
  var originalLevel = currentLogLevel;
  try {
    setLogLevel(level);
    return func();
  } finally {
    currentLogLevel = originalLevel;
  }
}

/**
 * Uloží nastavení úrovně logování do vlastností skriptu pro zachování mezi voláními.
 * @returns {boolean} True pokud se nastavení podařilo uložit
 */
function saveLogLevelSetting() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    scriptProperties.setProperty('LOG_LEVEL', getLogLevelName());
    return true;
  } catch (e) {
    Logger.log("Nelze uložit nastavení úrovně logování: " + e.toString());
    return false;
  }
}

/**
 * Načte uloženou úroveň logování z vlastností skriptu.
 * @returns {boolean} True pokud se nastavení podařilo načíst
 */
function loadLogLevelSetting() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    var savedLevel = scriptProperties.getProperty('LOG_LEVEL');
    if (savedLevel && LOG_LEVELS.hasOwnProperty(savedLevel)) {
      currentLogLevel = LOG_LEVELS[savedLevel];
      return true;
    }
    return false;
  } catch (e) {
    Logger.log("Nelze načíst nastavení úrovně logování: " + e.toString());
    return false;
  }
}

/**
 * Testovací funkce pro ověření, že logování funguje.
 */
function testLogging() {
  Logger.log("Začátek testu logování");
  
  // Uložíme původní úroveň logování
  var originalLevel = currentLogLevel;
  
  try {
    // Nastavíme úroveň na DEBUG pro test všech úrovní
    setLogLevel('DEBUG');
    
    // Test všech úrovní logování
    writeLogDebug("Test zpráva DEBUG úrovně");
    writeLogInfo("Test zpráva INFO úrovně");
    writeLogWarning("Test zpráva WARNING úrovně");
    writeLogError("Test zpráva ERROR úrovně");
    writeLogCritical("Test zpráva CRITICAL úrovně");
    
    // Test aliasů
    logDebug("Test DEBUG pomocí aliasu");
    logInfo("Test INFO pomocí aliasu");
    
    // Test zpětné kompatibility
    writeLog("Automaticky detekováno jako INFO");
    writeLog("Toto je varování, automaticky detekováno", LOG_LEVELS.WARNING);
    writeLog("Chyba v systému, automaticky detekována");
    
    // Test filtrace logů
    setLogLevel('WARNING');
    writeLogDebug("Tato DEBUG zpráva by neměla být poslána do GCP"); // Nebude odesláno
    writeLogInfo("Tato INFO zpráva by neměla být poslána do GCP");   // Nebude odesláno
    writeLogWarning("Tato WARNING zpráva bude poslána do GCP");      // Bude odesláno
    
    // Test funkce withLogLevel
    withLogLevel(function() {
      writeLogDebug("Tato DEBUG zpráva bude dočasně poslána do GCP");
      writeLogInfo("Tato INFO zpráva bude dočasně poslána do GCP");
    }, 'DEBUG');
    
    // Test vynuceného logování
    writeLogDebug("Tato DEBUG zpráva bude poslána navzdory nastavení", LOG_LEVELS.DEBUG, true);
    
    // Explicitní flush
    forceLogs();
    
  } finally {
    // Obnovíme původní úroveň logování
    currentLogLevel = originalLevel;
  }
  
  Logger.log("Test logování dokončen");
}