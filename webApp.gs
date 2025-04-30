/**
 * Kompletní řešení logování přes Web App
 * 
 * Toto řešení nabízí způsob, jak zajistit, aby logování fungovalo i v případě,
 * kdy se knihovna volá z různých skriptů nebo bez odpovídajících oprávnění.
 * 
 * NASAZENÍ:
 * 1. Vytvořte nový projekt Google Apps Script
 * 2. Vložte tento kód
 * 3. Nasaďte jako Web App:
 *    - Spouštět jako: nasaditel (vy)
 *    - Kdo má přístup: kdokoliv v doméně
 * 4. Zapamatujte si URL Web App pro pozdější použití
 */

// Konstanty definované mimo funkci pro lepší výkon
var RESOURCE = { "type": "global" };

/**
 * Nastaví potřebné vlastnosti pro logování
 */
function setupLogging(serviceAccountKey, logName, logLevel) {
  var scriptProperties = PropertiesService.getScriptProperties();
  
  // Uložení klíče služebního účtu
  if (serviceAccountKey) {
    scriptProperties.setProperty('SERVICE_ACCOUNT_KEY', serviceAccountKey);
  }
  
  // Uložení názvu logu
  if (logName) {
    scriptProperties.setProperty('LOG_NAME', logName);
  }
  
  // Uložení úrovně logování
  if (logLevel) {
    scriptProperties.setProperty('LOG_LEVEL', logLevel);
  }
  
  // Vrací aktuální nastavení
  return {
    logName: scriptProperties.getProperty('LOG_NAME'),
    logLevel: scriptProperties.getProperty('LOG_LEVEL'),
    serviceAccountKeySet: scriptProperties.getProperty('SERVICE_ACCOUNT_KEY') ? true : false
  };
}

// Proměnné pro batch logování
var logQueue = [];
var MAX_QUEUE_SIZE = 3; // Sníženo na 3, aby se logy posílaly častěji
var lastFlushTime = new Date().getTime();
var FLUSH_INTERVAL_MS = 5000; // 5 sekund

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

// Výchozí úroveň pro logování
var currentLogLevel = LOG_LEVELS.DEBUG;

/**
 * Aktualizuje globální proměnnou currentLogLevel z properties.
 * Volá se automaticky při inicializaci.
 */
function initLogLevel() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    var savedLevel = scriptProperties.getProperty('LOG_LEVEL');
    
    if (savedLevel && LOG_LEVELS.hasOwnProperty(savedLevel)) {
      currentLogLevel = LOG_LEVELS[savedLevel];
      Logger.log("Načtena úroveň logování z properties: " + savedLevel);
    } else {
      Logger.log("Použita výchozí úroveň logování: DEBUG");
    }
  } catch (e) {
    Logger.log("Chyba při inicializaci úrovně logování: " + e.toString());
  }
}

// Inicializace úrovně logování při načtení skriptu
initLogLevel();

/**
 * Jednoduchý test odeslání logu přímo do GCP
 */
function testLogging(message) {
  try {
    // Výchozí zpráva
    message = message || "Testovací zpráva z " + new Date().toISOString();
    
    // Získání potřebných hodnot
    var logName = getLogName();
    var accessToken = getAccessToken();
    
    // Vytvoření dat pro log
    var logData = {
      message: message,
      userEmail: Session.getEffectiveUser().getEmail(),
      functionName: "testLogging",
      timestamp: new Date().toISOString()
    };
    
    // Vytvoření GCP log záznamu
    var entries = [{
      "logName": logName,
      "resource": { "type": "global" },
      "jsonPayload": logData,
      "severity": "INFO",
      "timestamp": new Date().toISOString()
    }];
    
    // Odeslání do GCP
    var url = 'https://logging.googleapis.com/v2/entries:write';
    var options = {
      'method': 'post',
      'contentType': 'application/json',
      'headers': {
        'Authorization': 'Bearer ' + accessToken
      },
      'payload': JSON.stringify({ "entries": entries }),
      'muteHttpExceptions': true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    Logger.log("Test logování - Kód odpovědi: " + responseCode);
    
    return {
      success: responseCode === 200,
      code: responseCode,
      message: "Log úspěšně odeslán: " + message,
      response: responseCode === 200 ? "Úspěch" : response.getContentText()
    };
    
  } catch (e) {
    Logger.log("Chyba při testování logování: " + e.toString());
    return {
      success: false,
      error: e.toString(),
      stack: e.stack
    };
  }
}

/**
 * Povolí CORS pro Web App, aby ji mohly volat skripty z jiných domén
 * @param {Object} e - Parametry požadavku
 * @returns {HtmlOutput} HTML výstup
 */
function doGet(e) {
  return HtmlService.createHtmlOutput(
    'Logování přes Web App je aktivní. Pro použití zavolejte HTTP POST.'
  );
}

/**
 * Hlavní funkce pro zpracování požadavků na Web App
 * Zpracovává požadavky na logování
 * 
 * @param {Object} e - Parametry požadavku
 * @returns {TextOutput} Odpověď ve formátu JSON
 */
function doPost(e) {
  var startTime = new Date().getTime();
  
  try {
    // Parsování požadavku
    var request = JSON.parse(e.postData.contents);
    
    // Kontrola základní struktury a povinných položek
    if (!request || !request.message) {
      return createJsonResponse({
        status: 'error',
        error: 'Neplatný formát požadavku - chybí pole "message"'
      });
    }
    
    // Získat další parametry
    var level = request.level || 'INFO';
    var levelNumber = getLevelNumber(level);
    var forceLog = request.forceLog === true;
    
    // Kontrola úrovně logování
    if (!forceLog && levelNumber < currentLogLevel) {
      return createJsonResponse({
        status: 'skipped',
        message: 'Log přeskočen z důvodu nízké úrovně závažnosti'
      });
    }
    
    // Získat metadata
    var metadata = {
      userEmail: request.userEmail || Session.getEffectiveUser().getEmail(),
      documentName: request.documentName || 'Neznámý dokument',
      documentUrl: request.documentUrl || 'Neznámá URL',
      functionName: request.functionName || 'Neznámá funkce',
      timestamp: new Date().toISOString(),
      logLevel: level,
      customData: request.customData || {},
      clientIp: request.clientIp || e.userAgent || 'Neznámá IP'
    };
    
    // Konverze level na severity pro GCP
    var severity = levelToSeverity(level);
    
    // Logování zprávy
    var result = logToGCP(request.message, severity, metadata);
    
    // Vrátíme odpověď
    var elapsedTime = new Date().getTime() - startTime;
    return createJsonResponse({
      status: 'success',
      message: 'Log záznam vytvořen',
      processingTime: elapsedTime + ' ms',
      result: result
    });
    
  } catch (error) {
    return createJsonResponse({
      status: 'error',
      error: error.toString(),
      stack: error.stack
    });
  }
}

/**
 * Funkce pro testování logování přímo z kódu
 * 
 * @param {string} message - Zpráva k zalogování
 * @param {string} level - Úroveň logu
 * @returns {Object} Výsledek
 */
function testLogDirectly(message, level) {
  try {
    // Konstrukce testovacího požadavku
    var request = {
      message: message || "Testovací zpráva",
      level: level || "INFO",
      userEmail: Session.getEffectiveUser().getEmail(),
      documentName: "Test z konfiguračního rozhraní",
      documentUrl: ScriptApp.getService().getUrl(),
      functionName: "testLogDirectly",
      customData: {
        test: true,
        timestamp: new Date().toString()
      }
    };
    
    // Zpracování úrovně logování
    var severity = levelToSeverity(request.level);
    
    // Vytvoření dat logu
    var logData = {
      message: request.message,
      userEmail: request.userEmail,
      documentName: request.documentName,
      documentUrl: request.documentUrl,
      functionName: request.functionName,
      customData: request.customData,
      timestamp: new Date().toISOString(),
      logLevel: request.level
    };
    
    // Přímé odeslání logu
    var entries = [{
      "logName": getLogName(),
      "resource": RESOURCE,
      "jsonPayload": logData,
      "severity": severity,
      "timestamp": new Date().toISOString()
    }];
    
    var payload = {
      "entries": entries
    };
    
    var url = 'https://logging.googleapis.com/v2/entries:write';
    
    var options = {
      'method': 'post',
      'contentType': 'application/json',
      'headers': {
        'Authorization': 'Bearer ' + getAccessToken()
      },
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      throw new Error("Chyba při odesílání logu do GCP: " + response.getContentText());
    }
    
    // Záznam o úspěšném testování do Script logu
    Logger.log("Testovací log byl úspěšně odeslán: " + request.message);
    
    return {
      status: 'success',
      message: 'Log byl úspěšně odeslán',
      details: {
        level: request.level,
        severity: severity,
        responseCode: responseCode
      }
    };
  } catch (error) {
    Logger.log("Chyba při testování logu: " + error.toString());
    return {
      status: 'error',
      error: error.toString(),
      stack: error.stack
    };
  }
}

/**
 * Vytvoří JSON odpověď pro HTTP požadavky
 * 
 * @param {Object} data - Data, která mají být v odpovědi
 * @returns {TextOutput} Odpověď ve formátu JSON
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Získá číselnou hodnotu úrovně logování
 * 
 * @param {string} level - Úroveň logu jako text
 * @returns {number} Odpovídající číselná hodnota
 */
function getLevelNumber(level) {
  if (typeof level === 'number') return level;
  
  level = (level || '').toUpperCase();
  return LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : LOG_LEVELS.INFO;
}

/**
 * Převede textový level na severity pro GCP
 * 
 * @param {string} level - Úroveň logu ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')
 * @returns {string} Odpovídající GCP severity
 */
function levelToSeverity(level) {
  if (typeof level === 'number') {
    // Převeďte číselnou hodnotu zpět na textovou
    for (var key in LOG_LEVELS) {
      if (LOG_LEVELS[key] === level) {
        level = key;
        break;
      }
    }
  }
  
  level = (level || '').toUpperCase();
  switch (level) {
    case 'DEBUG': return 'DEBUG';
    case 'INFO': return 'INFO';
    case 'WARNING': return 'WARNING';
    case 'ERROR': return 'ERROR';
    case 'CRITICAL': return 'CRITICAL';
    default: return 'DEFAULT';
  }
}

/**
 * Získá název logu z nastavení projektu
 * 
 * @returns {string} Název logu nebo defaultní hodnota v případě chyby
 */
function getLogName() {
  try {
    var scriptProperties = PropertiesService.getScriptProperties();
    var logName = scriptProperties.getProperty('LOG_NAME');
    
    if (!logName) {
      // Pokud není nastaveno, použijeme ID projektu s výchozím názvem logu
      var projectId = ScriptApp.getScriptId();
      return 'projects/' + projectId + '/logs/app_script_logs';
    }
    
    return logName;
  } catch (e) {
    Logger.log("Nelze získat LOG_NAME: " + e.toString());
    return "projects/default-project/logs/app_script_logs";
  }
}

/**
 * Získá klíč služebního účtu z nastavení projektu
 * 
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
 * Vytvoří OAuth2 službu pro autentizaci
 * 
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
 * Získá přístupový token pro Google Cloud API
 * 
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
 * Zapíše log do Google Cloud Logging
 * 
 * @param {string} message - Zpráva k zalogování
 * @param {string} severity - Závažnost ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')
 * @param {Object} metadata - Doplňující metadata pro log
 * @returns {Object} Výsledek operace
 */
function logToGCP(message, severity, metadata) {
  try {
    var logName = getLogName();
    var accessToken = getAccessToken();
    
    var logData = {
      message: message,
      ...metadata,
      timestamp: new Date().toISOString()
    };
    
    // Přidání do fronty
    logQueue.push({
      "logName": logName,
      "resource": RESOURCE,
      "jsonPayload": logData,
      "severity": severity,
      "timestamp": new Date().toISOString()
    });
    
    // Pokud je fronta dostatečně velká nebo uplynul určitý čas, odesíláme logy
    var now = new Date().getTime();
    if (logQueue.length >= MAX_QUEUE_SIZE || (now - lastFlushTime > FLUSH_INTERVAL_MS)) {
      flushLogs();
    }
    
    return {
      success: true,
      message: "Log přidán do fronty pro odeslání",
      queueSize: logQueue.length
    };
  } catch (e) {
    Logger.log("Chyba při logování do GCP: " + e.toString());
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * Odešle všechny zprávy z fronty do Google Cloud Logging
 * 
 * @returns {Object} Výsledek operace
 */
function flushLogs() {
  if (logQueue.length === 0) {
    return { success: true, message: "Prázdná fronta, není co odesílat" };
  }
  
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
      // Při neúspěchu vrátit zpět do fronty
      logQueue = queueToSend.concat(logQueue);
      Logger.log('Chyba při odesílání logů do GCP: ' + response.getContentText());
      Logger.log('Kód odpovědi: ' + responseCode);
      return {
        success: false,
        code: responseCode,
        error: response.getContentText(),
        queueSize: logQueue.length
      };
    }
    
    return {
      success: true,
      code: responseCode,
      entriesSent: queueToSend.length
    };
  } catch (e) {
    // Při neúspěchu vrátit zpět do fronty
    if (queueToSend) {
      logQueue = queueToSend.concat(logQueue);
    }
    Logger.log('Výjimka při odesílání logů: ' + e.toString());
    return {
      success: false,
      error: e.toString(),
      queueSize: logQueue.length
    };
  }
}

/**
 * Nastaví minimální úroveň logování
 * 
 * @param {string} levelName - Název úrovně ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')
 * @returns {Object} Výsledek operace
 */
function setLogLevel(levelName) {
  try {
    levelName = levelName.toUpperCase();
    if (LOG_LEVELS.hasOwnProperty(levelName)) {
      currentLogLevel = LOG_LEVELS[levelName];
      
      // Uložit nastavení do vlastností skriptu
      var scriptProperties = PropertiesService.getScriptProperties();
      scriptProperties.setProperty('LOG_LEVEL', levelName);
      
      return {
        success: true,
        message: "Úroveň logování nastavena na: " + levelName
      };
    } else {
      return {
        success: false,
        error: "Neplatná úroveň logování: " + levelName
      };
    }
  } catch (e) {
    Logger.log("Chyba při nastavení úrovně logování: " + e.toString());
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * Získá aktuální úroveň logování
 * 
 * @returns {Object} Současná úroveň logování
 */
function getLogLevel() {
  try {
    // Načtení z vlastností skriptu
    var scriptProperties = PropertiesService.getScriptProperties();
    var savedLevel = scriptProperties.getProperty('LOG_LEVEL');
    
    // Pokud je uložena úroveň, použijeme ji
    if (savedLevel && LOG_LEVELS.hasOwnProperty(savedLevel)) {
      currentLogLevel = LOG_LEVELS[savedLevel];
    }
    
    // Vrátit aktuální úroveň
    for (var key in LOG_LEVELS) {
      if (LOG_LEVELS[key] === currentLogLevel) {
        return {
          success: true,
          level: key,
          numericValue: currentLogLevel
        };
      }
    }
    
    return {
      success: false,
      error: "Nepodařilo se získat aktuální úroveň logování"
    };
  } catch (e) {
    Logger.log("Chyba při získávání úrovně logování: " + e.toString());
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * Vynucené odeslání všech logů
 * 
 * @returns {Object} Výsledek operace
 */
function forceLogs() {
  return flushLogs();
}

/**
 * Funkce pro nastavení klíče služebního účtu - potřebná pro první nastavení
 * 
 * @param {string} serviceAccountKeyJson - JSON klíč služebního účtu jako řetězec
 * @returns {Object} Výsledek operace
 */
function setServiceAccountKey(serviceAccountKeyJson) {
  try {
    // Ověření, že jde o platný JSON
    var key = JSON.parse(serviceAccountKeyJson);
    
    // Kontrola přítomnosti povinných polí
    if (!key.private_key || !key.client_email) {
      return {
        success: false,
        error: "Neplatný formát klíče služebního účtu - chybí private_key nebo client_email"
      };
    }
    
    // Uložení do vlastností skriptu
    var scriptProperties = PropertiesService.getScriptProperties();
    scriptProperties.setProperty('SERVICE_ACCOUNT_KEY', serviceAccountKeyJson);
    
    return {
      success: true,
      message: "Klíč služebního účtu byl uložen"
    };
  } catch (e) {
    return {
      success: false,
      error: "Chyba při nastavení klíče služebního účtu: " + e.toString()
    };
  }
}

/**
 * Funkce pro nastavení názvu logu
 * 
 * @param {string} logName - Plná cesta k logu v GCP
 * @returns {Object} Výsledek operace
 */
function setLogName(logName) {
  try {
    // Validace formátu
    if (!logName.startsWith('projects/')) {
      return {
        success: false,
        error: "Neplatný formát názvu logu - musí začínat 'projects/'"
      };
    }
    
    // Uložení do vlastností skriptu
    var scriptProperties = PropertiesService.getScriptProperties();
    scriptProperties.setProperty('LOG_NAME', logName);
    
    return {
      success: true,
      message: "Název logu byl nastaven na: " + logName
    };
  } catch (e) {
    return {
      success: false,
      error: "Chyba při nastavení názvu logu: " + e.toString()
    };
  }
}