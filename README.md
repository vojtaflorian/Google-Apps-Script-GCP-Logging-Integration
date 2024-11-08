# Google Apps Script - GCP Logging Integration

This Google Apps Script (GAS) enables logging of messages from Google Sheets to Google Cloud Logging. It uses OAuth2 authentication to securely connect to Google Cloud Platform (GCP) and logs messages with relevant metadata, including the active document name, user email, and function name.

## Overview

This script is designed to:
- Log custom messages from Google Sheets to GCP.
- Use dynamic severity levels (INFO, WARNING, ERROR) based on the message content.
- Retrieve GCP log configurations (`LOG_NAME` and `SERVICE_ACCOUNT_KEY`) from Script Properties, enhancing security for publicly shared code.

## Setup

1. **Enable Google Cloud Logging API**
   - Enable the **Google Cloud Logging API** in your GCP project.

2. **Create a Service Account**
   - In GCP, create a service account with the role `Logging > Logs Writer`.
   - Download the JSON key file and note down the service account email.

3. **Add Script Properties**
   - In Google Apps Script, go to `File > Project properties > Script properties`.
   - Add the following properties:
     - `SERVICE_ACCOUNT_KEY`: Paste the JSON content of your service account key.
     - `LOG_NAME`: Set the log path, for example, `projects/YOUR_PROJECT_ID/logs/YOUR_LOG_NAME`.

4. **Configure OAuth2 Library**
   - Add the [OAuth2 Library](https://github.com/googleworkspace/apps-script-oauth2) to your script.
   - Use it to configure the OAuth2 service with the necessary scopes.

## Usage

- **writeLog(message)**: This function logs a given `message` to GCP with metadata such as:
  - Spreadsheet name and URL
  - User's email
  - Name of the calling function

  **Severity Levels**: 
  - `ERROR`: If the message contains "error" or "chyba" (case-insensitive).
  - `WARNING`: If the message contains "warning" or "varování" (case-insensitive).
  - `INFO`: Default level for all other messages.

- **getCallerFunctionName()**: Helper function that captures the name of the function that called `writeLog()`.

### Example

Add the `writeLog()` function within any custom Google Apps Script functions to record messages with relevant metadata.

```javascript
function exampleFunction() {
  writeLog("Example log message.");
}
