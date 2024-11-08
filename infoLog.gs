// Konstanty definované mimo funkci pro lepší výkon
var RESOURCE = {
  "type": "global"
};

function getLogName() {
  var scriptProperties = PropertiesService.getScriptProperties();
  return scriptProperties.getProperty('LOG_NAME');
}

function getServiceAccountKey() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var keyString = scriptProperties.getProperty('SERVICE_ACCOUNT_KEY');
  return JSON.parse(keyString);
}

function getOAuthService() {
  var key = getServiceAccountKey();

  return OAuth2.createService('GCPLogging')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setPrivateKey(key.private_key)
    .setIssuer(key.client_email)
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope('https://www.googleapis.com/auth/logging.write');
}

function getAccessToken() {
  var service = getOAuthService();
  if (service.hasAccess()) {
    var token = service.getAccessToken();
    return token;
  } else {
    Logger.log('infoLog: Chyba při získávání Access Token: ' + service.getLastError());
    throw new Error('Failed to authenticate.');
  }
}

function writeLog(message) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var userEmail = Session.getActiveUser().getEmail();
  var functionName = getCallerFunctionName();
  var logData = {
    message: message,
    documentName: doc.getName(),
    documentUrl: doc.getUrl(),
    userEmail: userEmail,
    functionName: functionName
  };

  var accessToken = getAccessToken();
  var logName = getLogName();

  // Zpracování závažnosti (severity)
  var severity = 'INFO';
  var messageLower = message.toLowerCase();
  if (messageLower.includes('chyba') || messageLower.includes('error')) {
    severity = 'ERROR';
  } else if (messageLower.includes('warning') || messageLower.includes('varování')) {
    severity = 'WARNING';
  }

  var entries = [{
    "logName": logName,
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
      'Authorization': 'Bearer ' + accessToken
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  var response = UrlFetchApp.fetch(url, options);

  if (response.getResponseCode() !== 200) {
    Logger.log('infoLog: Error logging to GCP: ' + response.getContentText());
    Logger.log('Response code: ' + response.getResponseCode());
    Logger.log('Request payload: ' + JSON.stringify(payload));
  }
}

// Pomocná funkce pro získání názvu volající funkce
function getCallerFunctionName() {
  try {
    var e = new Error();
    var stack = e.stack.toString().split('\n');
    // První řádek je chyba, druhý je tato funkce, třetí je volající funkce
    if (stack.length >= 4) {
      var callerLine = stack[3];
      var functionName = callerLine.match(/at ([\w$.]+)/)[1];
      return functionName;
    } else {
      return 'unknown';
    }
  } catch (e) {
    return 'unknown';
  }
}