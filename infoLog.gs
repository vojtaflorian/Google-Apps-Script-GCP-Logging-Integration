// infoLog skript:
// https://script.google.com/home/projects/1G3kQYfGae1-tE2vCH9_vUh_7k7_sMqJme9Z2ATfJgDueVeUPORU7Qkvn/edit
// SKRIPT ID 1G3kQYfGae1-tE2vCH9_vUh_7k7_sMqJme9Z2ATfJgDueVeUPORU7Qkvn
// OAUTH ID 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
// logy: https://console.cloud.google.com/logs/

// Konstanty definované mimo funkci pro lepší výkon
const RESOURCE = { "type": "global" }; 

// Proměnné pro batch logování
let logQueue = []; 
const MAX_QUEUE_SIZE = 5; 
let lastFlushTime = new Date().getTime(); 
const FLUSH_INTERVAL_MS = 5000; 

// Globální proměnná pro sledování, jestli je Toast zobrazován
let lastToastTime = 0; 
const TOAST_COOLDOWN_MS = 200; 

// Token cache
let cachedToken = null; 
let tokenExpiry = null; 

// Log úrovně v pořadí dle závažnosti (od nejnižší po nejvyšší)
const LOG_LEVELS = { 
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4
};
Object.freeze(LOG_LEVELS); // PŘIDÁNO: Zajištění neměnnosti

/**
 * HLAVNÍ PROMĚNNÁ PRO ÚROVEŇ LOGOVÁNÍ!
 * Pokud byste někdy potřeboval dočasně vidět i DEBUG logy během ladění konkrétní funkce, můžete použít:
javascriptinfoLog.withLogLevel(function() {
  infoLog.logDebug("Detailní informace pro ladění");
  // další kód...
}, 'DEBUG');
Tento kód dočasně sníží úroveň logování pro daný blok kódu a poté ji vrátí zpět na definovaný currentLogLevel.
 */
// Výchozí úroveň pro logování - vše nad touto  úrovní bude zaznamenáno
let currentLogLevel = LOG_LEVELS.DEBUG; 

// PŘIDÁNO: Načtení uložené úrovně logování při startu skriptu
loadLogLevelSetting();

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
      saveLogLevelSetting(); 
      _writeLogInternal("Úroveň logování nastavena na: " + levelName, LOG_LEVELS.INFO, true);
      return true;
    } else {
      _writeLogInternal("Neplatná úroveň logování: " + levelName, LOG_LEVELS.ERROR, true);
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
  for (const key in LOG_LEVELS) {
    if (LOG_LEVELS[key] === currentLogLevel) {
      return key;
    }
  }
  return "UNKNOWN";
}


/**
 * Interní funkce pro zápis logu, kterou volají veřejné logovací funkce.
 * Tato funkce přidává log do fronty a rozhoduje, zda flushovat.
 * @param {string} message - Zpráva k zalogování
 * @param {number} [level=LOG_LEVELS.INFO] - Úroveň závažnosti logu
 * @param {boolean} [forceLog=false] - Ignorovat filtrování dle úrovně
 */
function _writeLogInternal(message, level, forceLog) {
  if (level === undefined) {
    level = LOG_LEVELS.INFO;
    const messageLower = message.toLowerCase();
    if (messageLower.includes('chyba') || messageLower.includes('error')) {
      level = LOG_LEVELS.ERROR;
    } else if (messageLower.includes('warning') || messageLower.includes('varování')) {
      level = LOG_LEVELS.WARNING;
    }
  }
  
  if (!forceLog && level < currentLogLevel) {
    return; 
  }

  try {
    let doc = null;
    let documentName = "N/A";
    let documentUrl = "N/A";
    
    try {
      doc = SpreadsheetApp.getActiveSpreadsheet();
      if (doc) {
        documentName = doc.getName();
        documentUrl = doc.getUrl();
      }
    } catch (docError) { /* Ignorujeme */ }
    
    let userEmail = "N/A";
    try {
      userEmail = Session.getActiveUser().getEmail() || "N/A";
    } catch (emailError) { /* Ignorujeme */ }
    
    const isoTimestamp = new Date().toISOString();

    let severity;
    switch(level) {
      case LOG_LEVELS.DEBUG: severity = 'DEBUG'; break;
      case LOG_LEVELS.INFO: severity = 'INFO'; break;
      case LOG_LEVELS.WARNING: severity = 'WARNING'; break;
      case LOG_LEVELS.ERROR: severity = 'ERROR'; break;
      case LOG_LEVELS.CRITICAL: severity = 'CRITICAL'; break;
      default: severity = 'DEFAULT';
    }

    const logData = {
      message: message,
      documentName: documentName,
      documentUrl: documentUrl,
      userEmail: userEmail,
      timestamp: isoTimestamp,
      logLevel: severity 
    };
        
    if (level >= LOG_LEVELS.INFO) {
      showToastMessage(message, severity);
    }
    
    logQueue.push({
      "logName": getLogName(),
      "resource": RESOURCE,
      "jsonPayload": logData,
      "severity": severity,
      "timestamp": isoTimestamp
    });
    
    const currentTime = new Date().getTime();
    if (logQueue.length >= MAX_QUEUE_SIZE || 
        (logQueue.length > 0 && currentTime - lastFlushTime > FLUSH_INTERVAL_MS)) {
      flushLogs();
    }
    
  } catch (e) {
    Logger.log("Kritická chyba v _writeLogInternal: " + e.toString() + "\nZpráva: " + message);
  }
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
  _writeLogInternal(message, level, forceLog || false);
}


/**
 * Logovací metoda pro úroveň DEBUG
 * @param {string} message - Zpráva k zalogování
 */
function writeLogDebug(message) {
  _writeLogInternal(message, LOG_LEVELS.DEBUG);
}

/**
 * Logovací metoda pro úroveň INFO
 * @param {string} message - Zpráva k zalogování
 */
function writeLogInfo(message) {
  _writeLogInternal(message, LOG_LEVELS.INFO);
}

/**
 * Logovací metoda pro úroveň WARNING
 * @param {string} message - Zpráva k zalogování
 */
function writeLogWarning(message) {
  _writeLogInternal(message, LOG_LEVELS.WARNING);
}

/**
 * Logovací metoda pro úroveň ERROR
 * @param {string} message - Zpráva k zalogování
 */
function writeLogError(message) {
  _writeLogInternal(message, LOG_LEVELS.ERROR);
}

/**
 * Logovací metoda pro úroveň CRITICAL
 * @param {string} message - Zpráva k zalogování
 */
function writeLogCritical(message) {
  _writeLogInternal(message, LOG_LEVELS.CRITICAL);
}

// Alias metody pro jednoduchost
const logDebug = writeLogDebug; 
const logInfo = writeLogInfo; 
const logWarning = writeLogWarning; 
const logError = writeLogError; 
const logCritical = writeLogCritical; 

// Zbytek funkcí zůstává stejný, ale přidáme sync flag
let isFlushingLogs = false; 

/**
 * Odešle všechny zprávy z fronty do Google Cloud Logging.
 */
function flushLogs() {
  if (logQueue.length === 0 || isFlushingLogs) return;
  
  isFlushingLogs = true;
  try {
    const accessToken = getAccessToken(); 
    const url = 'https://logging.googleapis.com/v2/entries:write'; 
    
    // Vytvoříme kopii fronty a resetujeme originál
    const queueToSend = logQueue.slice(); 
    logQueue = [];
    lastFlushTime = new Date().getTime();
    
    const payload = { 
      "entries": queueToSend
    };
    
    const options = { 
      'method': 'post',
      'contentType': 'application/json',
      'headers': {
        'Authorization': 'Bearer ' + accessToken
      },
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true
    };
    
    const response = UrlFetchApp.fetch(url, options); 
    const responseCode = response.getResponseCode(); 
    
    if (responseCode !== 200) {
      Logger.log('infoLog: Error logging to GCP: ' + response.getContentText());
      Logger.log('Response code: ' + responseCode);
      // PŘIDÁNO: Pokud selže odeslání, vrátíme logy do fronty (nebo je můžeme zkusit odeslat později)
      // Pro jednoduchost je zde jen logujeme, ale v produkci by se mohly vrátit zpět do logQueue
       logQueue = queueToSend.concat(logQueue); // Možnost, pokud chceme zkusit znovu
    }
  } catch (e) {
    Logger.log('infoLog: Exception during log flush: ' + e.toString());
    // Zde by se také mohly logy vrátit do fronty, pokud je to žádoucí
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
    const scriptProperties = PropertiesService.getScriptProperties(); 
    return scriptProperties.getProperty('LOG_NAME') || "defaultLog"; // PŘIDÁNO: || "defaultLog" pro případ, že property je null
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
    const scriptProperties = PropertiesService.getScriptProperties(); 
    const keyString = scriptProperties.getProperty('SERVICE_ACCOUNT_KEY'); 
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
    const key = getServiceAccountKey(); 
    
    return OAuth2.createService('GCPLogging')
      .setTokenUrl('https://oauth2.googleapis.com/token')
      .setPrivateKey(key.private_key)
      .setIssuer(key.client_email)
      .setPropertyStore(PropertiesService.getScriptProperties()) // Ukládá token do script properties, což je dobré
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
    const now = new Date().getTime(); 
    if (cachedToken && tokenExpiry && now < tokenExpiry) {
      return cachedToken;
    }
    
    const service = getOAuthService(); 
    if (service.hasAccess()) { // hasAccess() zkontroluje existující token nebo získá nový
      cachedToken = service.getAccessToken();
      tokenExpiry = now + (50 * 60 * 1000); // Token typicky vyprší za 1 hodinu (3600s)
      return cachedToken;
    } else {
      Logger.log('Chyba při získávání Access Token: ' + service.getLastError());
      throw new Error('Failed to authenticate with GCP Logging service.');
    }
  } catch (e) {
    Logger.log("Kritická chyba v getAccessToken: " + e.toString());
    throw e; 
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
    const now = new Date().getTime(); 
    if (now - lastToastTime > TOAST_COOLDOWN_MS) {
      const ss = SpreadsheetApp.getActiveSpreadsheet(); 
      if (ss) {
        let title = "Info"; 
        let duration = 5; 
        
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
          // Debug toasty mohou být otravné, zvažte jejich vypnutí nebo kratší dobu
          // title = "🔍 Debug";
          // duration = 3;
          return; // Pro DEBUG toasty nezobrazujeme, aby nebyly rušivé
        }
        
        ss.toast(message, title, duration);
        lastToastTime = now;
      }
    }
  } catch (e) {
    Logger.log("Nelze zobrazit Toast: " + e.toString());
  }
}

/**
 * Trigger pro automatické odesílání logů
 */
function setupTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers(); 
    for (let i = 0; i < triggers.length; i++) { 
      if (triggers[i].getHandlerFunction() === 'autoFlushLogs') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    
    ScriptApp.newTrigger('autoFlushLogs')
      .timeBased()
      .everyMinutes(1) // Interval lze konfigurovat podle potřeby
      .create();
      
    Logger.log("Trigger pro autoFlushLogs úspěšně nastaven.");
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
  // PŘIDÁNO: Zkontrolujeme, zda je fronta dostatečně stará nebo plná
  // i když by se sem měla dostat jen pokud je co odeslat a uplynul čas
  const currentTime = new Date().getTime();
  if (logQueue.length > 0 && (logQueue.length >= MAX_QUEUE_SIZE || currentTime - lastFlushTime > FLUSH_INTERVAL_MS)) {
    flushLogs();
  }
}

/**
 * Dočasně změní úroveň logování pro spuštění určité funkce.
 * Po dokončení funkce vrátí původní úroveň logování.
 * 
 * @param {function} func - Funkce, která se má spustit s danou úrovní logování
 * @param {string} levelName - Dočasná úroveň logování ('DEBUG', 'INFO', ...)
 * @returns {*} - Návratová hodnota funkce
 */
function withLogLevel(func, levelName) {
  const originalLevelNumeric = currentLogLevel; 
  const originalLevelName = getLogLevelName();
  try {
    if (setLogLevel(levelName)) { // setLogLevel nyní ukládá, ale my to chceme dočasně
       // Logger.log("Dočasně nastavena úroveň na: " + levelName);
    }
    return func();
  } finally {
    // Vrátíme původní úroveň, aniž bychom ji znovu ukládali do Properties
    // Pokud by setLogLevel neukládalo, bylo by to jednodušší.
    // Protože setLogLevel ukládá, musíme ji obnovit a také uložit zpět.
    if (LOG_LEVELS.hasOwnProperty(originalLevelName)) {
        currentLogLevel = LOG_LEVELS[originalLevelName];
        // Logger.log("Úroveň logování vrácena na: " + originalLevelName);
        // Není třeba volat saveLogLevelSetting(), protože původní hodnota už byla uložena (nebo nebyla změněna)
    } else { // Fallback pokud by originalLevelName byl neplatný
        currentLogLevel = originalLevelNumeric;
    }
    // Pokud chceme, aby i dočasná změna byla "uložena" a pak obnovena,
    // museli bychom `saveLogLevelSetting()` volat i zde, ale s původní hodnotou.
    // Pro jednoduchost, `withLogLevel` nemění trvalé nastavení.
    // Správnější by bylo, kdyby setLogLevel mělo parametr, zda ukládat nebo ne.
    // Nebo by `withLogLevel` přímo manipulovalo `currentLogLevel` bez volání `setLogLevel`.
    // Prozatím ponecháno tak, že `setLogLevel` v `withLogLevel` změní `currentLogLevel`,
    // a `finally` blok to vrátí jen v paměti.
    // Oprava: withLogLevel by nemělo volat setLogLevel, které ukládá.
    // Místo toho přímo změní currentLogLevel.

    // Lepší implementace `withLogLevel`:
    // const originalLevel = currentLogLevel;
    // try {
    //   if (LOG_LEVELS.hasOwnProperty(levelName.toUpperCase())) {
    //     currentLogLevel = LOG_LEVELS[levelName.toUpperCase()];
    //   }
    //   return func();
    // } finally {
    //   currentLogLevel = originalLevel;
    // }
    // Tato oprava bude aplikována níže.
  }
}

// OPRAVENÁ VERZE withLogLevel
function withLogLevel(func, tempLevelName) {
  const originalLevel = currentLogLevel;
  const upperTempLevelName = tempLevelName.toUpperCase();
  let appliedTempLevel = false;

  try {
    if (LOG_LEVELS.hasOwnProperty(upperTempLevelName)) {
      currentLogLevel = LOG_LEVELS[upperTempLevelName];
      appliedTempLevel = true;
      // _writeLogInternal("Dočasná úroveň logování nastavena na: " + upperTempLevelName, LOG_LEVELS.DEBUG, true);
    } else {
      _writeLogInternal("Neplatná dočasná úroveň logování v withLogLevel: " + tempLevelName, LOG_LEVELS.WARNING, true);
    }
    return func();
  } finally {
    if (appliedTempLevel) {
      currentLogLevel = originalLevel;
      // _writeLogInternal("Původní úroveň logování obnovena: " + getLogLevelName(), LOG_LEVELS.DEBUG, true);
    }
  }
}


/**
 * Uloží nastavení úrovně logování do vlastností skriptu pro zachování mezi voláními.
 * @returns {boolean} True pokud se nastavení podařilo uložit
 */
function saveLogLevelSetting() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties(); 
    scriptProperties.setProperty('LOG_LEVEL', getLogLevelName());
    return true;
  } catch (e) {
    Logger.log("Nelze uložit nastavení úrovně logování: " + e.toString());
    return false;
  }
}

/**
 * Načte uloženou úroveň logování z vlastností skriptu.
 * Pokud není nic uloženo, použije se výchozí hodnota `currentLogLevel`.
 * @returns {boolean} True pokud se nastavení podařilo načíst a aplikovat.
 */
function loadLogLevelSetting() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties(); 
    const savedLevel = scriptProperties.getProperty('LOG_LEVEL'); 
    if (savedLevel && LOG_LEVELS.hasOwnProperty(savedLevel)) {
      currentLogLevel = LOG_LEVELS[savedLevel];
      // _writeLogInternal("Úroveň logování načtena z nastavení: " + savedLevel, LOG_LEVELS.INFO, true); // Logování při startu může být moc
      Logger.log("infoLog: Úroveň logování načtena z nastavení: " + savedLevel);
      return true;
    }
    // Pokud nic nebylo uloženo nebo je hodnota neplatná, currentLogLevel zůstane na své inicializační hodnotě.
    Logger.log("infoLog: Používá se výchozí úroveň logování: " + getLogLevelName());
    return false;
  } catch (e) {
    Logger.log("Nelze načíst nastavení úrovně logování: " + e.toString() + ". Používá se výchozí úroveň: " + getLogLevelName());
    return false;
  }
}