const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const nodemailer = require("nodemailer");
const readXlsxFile = require("read-excel-file/node");
const sanitizeHtml = require("sanitize-html");

const app = express();
const port = Number(process.env.PORT) || 4000;
const maxRecipients = 50;
const maxAttachmentSize = 10 * 1024 * 1024;
const campaigns = new Map();

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    done(
      extension === ".xlsx"
        ? null
        : new Error("Only .xlsx files are supported."),
      extension === ".xlsx",
    );
  },
});

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxAttachmentSize,
    files: 1,
    fields: 10,
    fieldSize: 512 * 1024,
  },
  fileFilter: (_request, file, done) => {
    const blockedExtensions = new Set([
      ".bat",
      ".cmd",
      ".com",
      ".exe",
      ".js",
      ".msi",
      ".ps1",
      ".scr",
      ".vbs",
    ]);
    const extension = path.extname(file.originalname).toLowerCase();
    done(
      blockedExtensions.has(extension)
        ? new Error("Executable or script attachments are not allowed.")
        : null,
      !blockedExtensions.has(extension),
    );
  },
});

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

async function extractEmails(buffer) {
  const sheets = await readXlsxFile(buffer);
  const firstSheet = sheets[0];
  if (!firstSheet) {
    throw new Error("The workbook does not contain a worksheet.");
  }

  const sheetName = firstSheet.sheet;
  const rows = firstSheet.data;
  if (!rows.length) {
    throw new Error("The first worksheet is empty.");
  }

  const headers = rows[0].map((value) =>
    String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  const emailColumn = headers.findIndex((header) =>
    ["email", "emailaddress", "mail", "mailid"].includes(header),
  );

  if (emailColumn === -1) {
    throw new Error('No "Email" column was found in the first row.');
  }

  const seen = new Set();
  const emails = [];
  let invalidCount = 0;

  for (const row of rows.slice(1)) {
    const email = String(row[emailColumn] ?? "").trim().toLowerCase();
    if (!email) continue;
    if (!isEmail(email)) {
      invalidCount += 1;
      continue;
    }
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }

  return { emails, invalidCount, sheetName };
}

function publicCampaign(campaign) {
  return {
    id: campaign.id,
    status: campaign.status,
    total: campaign.total,
    processed: campaign.processed,
    success: campaign.success,
    failed: campaign.failed,
    currentEmail: campaign.currentEmail,
    results: campaign.results,
    error: campaign.error || "",
  };
}

function publish(campaign) {
  const payload = `data: ${JSON.stringify(publicCampaign(campaign))}\n\n`;
  for (const response of campaign.listeners) response.write(payload);
}

function plainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function cleanEmailHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "b",
      "blockquote",
      "br",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "hr",
      "i",
      "li",
      "ol",
      "p",
      "span",
      "strong",
      "u",
      "ul",
    ],
    allowedAttributes: {
      a: ["href", "target"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i],
        "font-size": [/^\d+(?:px|em|rem|%)$/],
        "text-align": [/^(?:left|center|right|justify)$/],
      },
    },
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          target: "_blank",
        },
      }),
    },
  });
}

async function runCampaign(campaign, settings) {
  const transport = nodemailer.createTransport({
    service: settings.provider,
    auth: { user: settings.senderEmail, pass: settings.appPassword },
    pool: true,
    maxConnections: 1,
    maxMessages: maxRecipients,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  try {
    campaign.status = "verifying";
    publish(campaign);
    await transport.verify();
    if (campaign.status === "cancelled") return;
    campaign.status = "sending";
    publish(campaign);

    for (const recipient of settings.recipients) {
      if (campaign.status === "cancelled") break;
      campaign.currentEmail = recipient;
      publish(campaign);

      try {
        await transport.sendMail({
          from: settings.senderEmail,
          to: recipient,
          subject: settings.subject,
          html: settings.html,
          text: plainText(settings.html),
          attachments: settings.attachment
            ? [
                {
                  filename: settings.attachment.filename,
                  content: settings.attachment.buffer,
                  contentType: settings.attachment.contentType,
                },
              ]
            : [],
        });
        campaign.success += 1;
        campaign.results.push({ email: recipient, status: "success" });
      } catch (error) {
        campaign.failed += 1;
        campaign.results.push({
          email: recipient,
          status: "failed",
          error: String(error.message || "Delivery failed").slice(0, 180),
        });
      }

      campaign.processed += 1;
      publish(campaign);
      if (campaign.processed < campaign.total) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }

    if (campaign.status !== "cancelled") campaign.status = "completed";
  } catch (error) {
    campaign.status = "error";
    campaign.error = String(error.message || "Could not connect to the mail server");
    campaign.failed = campaign.total - campaign.success;
  } finally {
    campaign.currentEmail = "";
    transport.close();
    publish(campaign);
    setTimeout(() => campaigns.delete(campaign.id), 30 * 60 * 1000).unref();
  }
}

app.post("/api/import", upload.single("file"), async (request, response) => {
  try {
    if (!request.file) {
      return response.status(400).json({ error: "Choose an Excel file first." });
    }
    const parsed = await extractEmails(request.file.buffer);
    return response.json({
      ...parsed,
      selectedEmails: parsed.emails.slice(0, maxRecipients),
      limit: maxRecipients,
    });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
});

app.post("/api/campaigns", attachmentUpload.single("attachment"), (request, response) => {
  const { senderEmail, appPassword, provider, subject, html } = request.body;
  let recipients;
  try {
    recipients = JSON.parse(request.body.recipients || "[]");
  } catch {
    return response.status(400).json({ error: "The recipient list is invalid." });
  }

  if (!isEmail(senderEmail)) {
    return response.status(400).json({ error: "Enter a valid sender email." });
  }
  if (typeof appPassword !== "string" || appPassword.trim().length < 8) {
    return response.status(400).json({ error: "Enter a valid app password." });
  }
  if (!["gmail", "hotmail"].includes(provider)) {
    return response.status(400).json({ error: "Choose a supported provider." });
  }
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200) {
    return response.status(400).json({ error: "Enter a subject (maximum 200 characters)." });
  }
  const safeHtml = typeof html === "string" ? cleanEmailHtml(html) : "";
  if (!plainText(safeHtml)) {
    return response.status(400).json({ error: "Enter the email content." });
  }
  if (safeHtml.length > 250_000) {
    return response.status(400).json({ error: "Email content is too large." });
  }
  if (
    !Array.isArray(recipients) ||
    recipients.length === 0 ||
    recipients.length > maxRecipients ||
    recipients.some((email) => !isEmail(email))
  ) {
    return response
      .status(400)
      .json({ error: `Choose between 1 and ${maxRecipients} valid recipients.` });
  }

  const uniqueRecipients = [...new Set(recipients.map((email) => email.toLowerCase()))];
  const campaign = {
    id: crypto.randomUUID(),
    status: "queued",
    total: uniqueRecipients.length,
    processed: 0,
    success: 0,
    failed: 0,
    currentEmail: "",
    results: [],
    listeners: new Set(),
  };
  campaigns.set(campaign.id, campaign);

  response.status(202).json({ id: campaign.id });
  setImmediate(() =>
    runCampaign(campaign, {
      senderEmail: senderEmail.trim(),
      appPassword: appPassword.trim(),
      provider,
      subject: subject.trim(),
      html: safeHtml,
      recipients: uniqueRecipients,
      attachment: request.file
        ? {
            filename: path.basename(request.file.originalname),
            contentType: request.file.mimetype,
            buffer: request.file.buffer,
          }
        : null,
    }),
  );
});

app.get("/api/campaigns/:id/events", (request, response) => {
  const campaign = campaigns.get(request.params.id);
  if (!campaign) return response.status(404).end();

  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.flushHeaders();
  campaign.listeners.add(response);
  response.write(`data: ${JSON.stringify(publicCampaign(campaign))}\n\n`);

  const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 15000);
  request.on("close", () => {
    clearInterval(heartbeat);
    campaign.listeners.delete(response);
  });
});

app.post("/api/campaigns/:id/cancel", (request, response) => {
  const campaign = campaigns.get(request.params.id);
  if (!campaign) return response.status(404).json({ error: "Campaign not found." });
  if (!["queued", "verifying", "sending"].includes(campaign.status)) {
    return response.status(409).json({ error: "Campaign has already stopped." });
  }
  campaign.status = "cancelled";
  publish(campaign);
  return response.json({ ok: true });
});

app.use((error, _request, response, _next) => {
  response.status(400).json({ error: error.message || "Request failed." });
});

app.listen(port, () => {
  console.log(`Email sender running at http://localhost:${port}`);
});
