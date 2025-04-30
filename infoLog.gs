/**
 * Klientská knihovna infoLog pro připojení k logovací Web App
 */

// !!! DŮLEŽITÉ: Změňte tuto URL na adresu vaší nasazené Web App !!!
var WEB_APP_URL = 'https://script.google.com/a/macros/megapixel.cz/s/AKfycbzCZaiBRIj-YOp3QpPp722WQ33zGwoOA2AX-cwCvUXhlA9J5H2qT2qMuJY3AAi1Bmlddw/exec';


// Log úrovně v pořadí dle závažnosti (od nejnižší po nejvyšší)
var LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4
};

// Výchozí úroveň pro logování - vše nad touto úrovní bude zaznamenáno
var currentLogLevel = LOG_LEVELS.DEBUG;

// Fronta logů pro případ nedostupnosti Web App
var logQueue = [];
var isProcessingQueue = false;

/**
 * Hlavní logovací funkce - všechny ostatní metody volají tuto.
 * 
 * @param {string} message - Zpráva k zalogování
 * @param {number|string} [level] - Úroveň závažnosti logu
 * @param {boolean} [forceLog=false] - Ignorovat filtrování dle úrovně
 * @returns {Object} Informace o logu
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

  // Převod textové úrovně na číslo, pokud je potřeba
  if (typeof level === 'string') {
    level = LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO;
  }
  
  // Sestavení dat logu
  var logData = createLogData(message, level, forceLog);
  
  // Odeslání logu na Web App
  try {
    sendLogToWebApp(logData);
    return logData;
  } catch (e) {
    // Při chybě přidat do fronty a zpracovat frontu později
    logQueue.push(logData);
    processLogQueue();
    
    // Logování přímo do Logger pro případ, že Web App je nedostupná
    Logger.log("infoLog (záložní): " + message);
    return logData;
  }
}

/**
 * Vytvoří kompletní data logu včetně metadat
 */
function createLogData(message, level, forceLog) {
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
  
  // Převod úrovně na textovou reprezentaci
  var levelName = "INFO";
  for (var key in LOG_LEVELS) {
    if (LOG_LEVELS[key] === level) {
      levelName = key;
      break;
    }
  }
  
  return {
    message: message,
    level: levelName,
    forceLog: forceLog === true,
    userEmail: userEmail,
    documentName: documentName,
    documentUrl: documentUrl,
    functionName: functionName,
    timestamp: new Date().toISOString(),
    customData: {
      clientVersion: "1.0.0"
    }
  };
}

/**
 * Odešle log do Web App
 */
function sendLogToWebApp(logData) {
  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(logData),
    'muteHttpExceptions': true
  };
  
  var response = UrlFetchApp.fetch(WEB_APP_URL, options);
  
  if (response.getResponseCode() !== 200) {
    throw new Error("Chyba při odesílání logu: " + response.getContentText());
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * Zpracuje frontu logů, když Web App nebyla dostupná
 */
function processLogQueue() {
  if (isProcessingQueue || logQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  try {
    // Kopírování fronty a její vyčištění
    var currentQueue = logQueue.slice();
    logQueue = [];
    
    // Odeslání každého logu zvlášť
    currentQueue.forEach(function(logData) {
      try {
        sendLogToWebApp(logData);
      } catch (e) {
        // Pokud selže, vrátíme zpět do fronty
        logQueue.push(logData);
      }
    });
  } finally {
    isProcessingQueue = false;
    
    // Pokud zbývají položky ve frontě, pouze zalogujeme
    if (logQueue.length > 0) {
      Logger.log("Zbývají nezpracované logy v queue: " + logQueue.length);
    }
  }
}

/**
 * Zjistí název volající funkce z call stacku
 */
function getCallerFunctionName() {
  try {
    var e = new Error();
    var stack = e.stack.toString().split('\n');
    // První řádek je chyba, druhý je tato funkce, třetí je writeLog, čtvrtý je metoda která volá writeLog, pátý je volající funkce
    if (stack.length >= 6) {
      var callerLine = stack[5];
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
 * Logovací metoda pro úroveň DEBUG
 */
function writeLogDebug(message) {
  return writeLog(message, LOG_LEVELS.DEBUG);
}

/**
 * Logovací metoda pro úroveň INFO
 */
function writeLogInfo(message) {
  return writeLog(message, LOG_LEVELS.INFO);
}

/**
 * Logovací metoda pro úroveň WARNING
 */
function writeLogWarning(message) {
  return writeLog(message, LOG_LEVELS.WARNING);
}

/**
 * Logovací metoda pro úroveň ERROR
 */
function writeLogError(message) {
  return writeLog(message, LOG_LEVELS.ERROR);
}

/**
 * Logovací metoda pro úroveň CRITICAL
 */
function writeLogCritical(message) {
  return writeLog(message, LOG_LEVELS.CRITICAL);
}

// Alias metody pro jednoduchost
var logDebug = writeLogDebug;
var logInfo = writeLogInfo;
var logWarning = writeLogWarning;
var logError = writeLogError;
var logCritical = writeLogCritical;

/**
 * Vynucené odeslání všech logů - užitečné volat na konci skriptu
 */
function forceLogs() {
  processLogQueue();
  return { success: true, queueSize: logQueue.length };
}

/**
 * Nastaví minimální úroveň logování lokálně
 */
function setLogLevel(levelName) {
  if (typeof levelName === 'string' && LOG_LEVELS.hasOwnProperty(levelName.toUpperCase())) {
    currentLogLevel = LOG_LEVELS[levelName.toUpperCase()];
    return true;
  }
  return false;
}

/**
 * Dočasně zvýší úroveň logování pro spuštění určité funkce
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