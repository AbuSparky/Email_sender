# Nellai Mass Foods Email Campaign Sender

A local web application for importing `.xlsx` recipient lists and sending a formatted
email sequentially to a maximum of 50 unique addresses per campaign.

## Run

1. Install Node.js 20 or newer.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

The sender email and app password are held in server memory only for the duration of
the campaign. They are never written to disk.

## Workbook format

The first row of the first worksheet must contain a column named `Email`. The app
skips empty, invalid, and duplicate addresses and selects at most the first 50 valid
addresses.

## Email account requirements

- Gmail and Google Workspace accounts need 2-Step Verification and a Google app
  password.
- Outlook and Microsoft 365 accounts must allow SMTP AUTH. Some organizations disable
  it; their administrator must enable it before app-password SMTP can work.
- Use this only for recipients who have agreed to receive the email.

## Limits

- Excel workbook: 5 MB
- Recipients: 50 per campaign
- Attachment: one file, 10 MB
- Executable and script attachments are blocked
