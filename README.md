# Nellai Mass Foods Email Campaign Sender

A local web application for importing `.xlsx` recipient lists and sending a formatted
email sequentially to a maximum of 50 unique addresses per campaign.

## Run

1. Install Node.js 20 or newer.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:4000`.

The SMTP settings and password are held in server memory only for the duration of the
campaign. They are never written to disk.

## Workbook format

The first row of the first worksheet must contain a column named `Email`. The app
skips empty, invalid, and duplicate addresses and selects at most the first 50 valid
addresses.

## Email account requirements

- For Gmail use host `smtp.gmail.com`, port `465`, and SSL/TLS enabled.
- For Microsoft 365 use host `smtp.office365.com`, port `587`, and STARTTLS.
- Gmail and Google Workspace accounts need 2-Step Verification and a Google app
  password.
- Outlook and Microsoft 365 accounts must allow SMTP AUTH. Some organizations disable
  it; their administrator must enable it before app-password SMTP can work.
- Use this only for recipients who have agreed to receive the email.

Render's free web-service plan blocks outbound SMTP ports 465 and 587. Use a paid
Render instance or an HTTPS-based email provider API for production delivery.

## Limits

- Excel workbook: 5 MB
- Recipients: 50 per campaign
- Attachment: one file, 10 MB
- Executable and script attachments are blocked
