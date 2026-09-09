const MAX_RECIPIENTS = 50;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const elements = {
  form: document.querySelector("#campaign-form"),
  provider: document.querySelector("#provider"),
  senderEmail: document.querySelector("#sender-email"),
  appPassword: document.querySelector("#app-password"),
  togglePassword: document.querySelector("#toggle-password"),
  subject: document.querySelector("#subject"),
  editor: document.querySelector("#editor"),
  fileInput: document.querySelector("#file-input"),
  uploadZone: document.querySelector("#upload-zone"),
  importSummary: document.querySelector("#import-summary"),
  fileName: document.querySelector("#file-name"),
  importDetail: document.querySelector("#import-detail"),
  changeFile: document.querySelector("#change-file"),
  recipientPreview: document.querySelector("#recipient-preview"),
  recipientCount: document.querySelector("#recipient-count"),
  emailChips: document.querySelector("#email-chips"),
  attachmentInput: document.querySelector("#attachment-input"),
  attachmentButton: document.querySelector("#attachment-button"),
  attachmentSummary: document.querySelector("#attachment-summary"),
  attachmentName: document.querySelector("#attachment-name"),
  attachmentSize: document.querySelector("#attachment-size"),
  removeAttachment: document.querySelector("#remove-attachment"),
  formAlert: document.querySelector("#form-alert"),
  sendButton: document.querySelector("#send-button"),
  progressCard: document.querySelector("#progress-card"),
  progressMessage: document.querySelector("#progress-message"),
  progressBar: document.querySelector("#progress-bar"),
  processedCount: document.querySelector("#processed-count"),
  successCount: document.querySelector("#success-count"),
  failureCount: document.querySelector("#failure-count"),
  totalCount: document.querySelector("#total-count"),
  resultsList: document.querySelector("#results-list"),
  cancelButton: document.querySelector("#cancel-button"),
};

let recipients = [];
let attachment = null;
let campaignId = null;
let eventSource = null;
let isSending = false;

function showAlert(message) {
  elements.formAlert.textContent = message;
  elements.formAlert.classList.toggle("hidden", !message);
  if (message) elements.formAlert.scrollIntoView({ behavior: "smooth", block: "center" });
}

function readableBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateSendButton() {
  elements.sendButton.disabled = isSending || recipients.length === 0;
}

function renderRecipients() {
  elements.emailChips.replaceChildren(
    ...recipients.map((email) => {
      const chip = document.createElement("span");
      chip.className = "email-chip";
      chip.textContent = email;
      return chip;
    }),
  );
  elements.recipientCount.textContent = `${recipients.length} / ${MAX_RECIPIENTS}`;
  elements.recipientPreview.classList.toggle("hidden", recipients.length === 0);
  updateSendButton();
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

async function importWorkbook(file) {
  if (!file) return;
  showAlert("");
  elements.uploadZone.disabled = true;
  elements.uploadZone.querySelector("strong").textContent = "Reading workbook…";

  try {
    const data = new FormData();
    data.append("file", file);
    const result = await fetch("/api/import", { method: "POST", body: data }).then(responseJson);
    recipients = result.selectedEmails;
    elements.fileName.textContent = file.name;

    const notes = [
      `${result.emails.length} unique valid email${result.emails.length === 1 ? "" : "s"} found`,
    ];
    if (result.emails.length > result.limit) notes.push(`first ${result.limit} selected`);
    if (result.invalidCount) notes.push(`${result.invalidCount} invalid skipped`);
    elements.importDetail.textContent = `${notes.join(" · ")} · Sheet: ${result.sheetName}`;

    elements.uploadZone.classList.add("hidden");
    elements.importSummary.classList.remove("hidden");
    renderRecipients();
  } catch (error) {
    recipients = [];
    renderRecipients();
    showAlert(error.message);
  } finally {
    elements.uploadZone.disabled = false;
    elements.uploadZone.querySelector("strong").textContent = "Choose an Excel file";
  }
}

function chooseAttachment(file) {
  if (!file) return;
  const blocked = /\.(?:bat|cmd|com|exe|js|msi|ps1|scr|vbs)$/i.test(file.name);
  if (blocked) {
    showAlert("Executable or script attachments are not allowed.");
    return;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    showAlert("The attachment must be 10 MB or smaller.");
    return;
  }

  attachment = file;
  elements.attachmentName.textContent = file.name;
  elements.attachmentSize.textContent = readableBytes(file.size);
  elements.attachmentSummary.classList.remove("hidden");
  elements.attachmentButton.textContent = "Change attachment";
  showAlert("");
}

function statusMessage(campaign) {
  const messages = {
    queued: "Campaign queued…",
    verifying: "Verifying your email account…",
    sending: campaign.currentEmail
      ? `Sending to ${campaign.currentEmail}`
      : "Starting delivery…",
    completed: `Campaign complete: ${campaign.success} sent, ${campaign.failed} failed.`,
    cancelled: `Campaign cancelled after ${campaign.processed} email${
      campaign.processed === 1 ? "" : "s"
    }.`,
    error: campaign.error || "The campaign could not be started.",
  };
  return messages[campaign.status] || "Preparing your campaign…";
}

function renderResults(results) {
  elements.resultsList.replaceChildren(
    ...results.map((result) => {
      const row = document.createElement("div");
      row.className = "result-row";

      const detail = document.createElement("div");
      detail.textContent = result.email;
      if (result.error) {
        const error = document.createElement("small");
        error.textContent = result.error;
        detail.append(error);
      }

      const status = document.createElement("span");
      status.className = `result-status ${result.status}`;
      status.textContent = result.status === "success" ? "Sent" : "Failed";
      row.append(detail, status);
      return row;
    }),
  );
}

function finishCampaign(campaign) {
  isSending = false;
  campaignId = null;
  elements.form.removeAttribute("aria-busy");
  elements.cancelButton.disabled = true;
  elements.appPassword.value = "";
  updateSendButton();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (campaign.status === "error") showAlert(campaign.error);
}

function updateProgress(campaign) {
  const percentage = campaign.total ? (campaign.processed / campaign.total) * 100 : 0;
  elements.progressMessage.textContent = statusMessage(campaign);
  elements.progressBar.style.width = `${percentage}%`;
  elements.processedCount.textContent = campaign.processed;
  elements.successCount.textContent = campaign.success;
  elements.failureCount.textContent = campaign.failed;
  elements.totalCount.textContent = campaign.total;
  renderResults(campaign.results);

  if (["completed", "cancelled", "error"].includes(campaign.status)) finishCampaign(campaign);
}

function watchCampaign(id) {
  eventSource = new EventSource(`/api/campaigns/${encodeURIComponent(id)}/events`);
  eventSource.onmessage = (event) => updateProgress(JSON.parse(event.data));
  eventSource.onerror = () => {
    if (!isSending) return;
    elements.progressMessage.textContent =
      "Live connection was interrupted. Delivery may still be running.";
  };
}

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    const command = button.dataset.command;
    if (command === "createLink") {
      const url = window.prompt("Enter a complete URL, for example https://example.com");
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
          showAlert("Links must use http, https, or mailto.");
          return;
        }
      } catch {
        showAlert("Enter a valid, complete URL.");
        return;
      }
      document.execCommand(command, false, url);
    } else {
      document.execCommand(command, false);
    }
    elements.editor.focus();
  });
});

elements.togglePassword.addEventListener("click", () => {
  const reveal = elements.appPassword.type === "password";
  elements.appPassword.type = reveal ? "text" : "password";
  elements.togglePassword.textContent = reveal ? "Hide" : "Show";
});

elements.uploadZone.addEventListener("click", () => elements.fileInput.click());
elements.changeFile.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => importWorkbook(elements.fileInput.files[0]));

["dragenter", "dragover"].forEach((type) => {
  elements.uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((type) => {
  elements.uploadZone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.remove("dragging");
  });
});
elements.uploadZone.addEventListener("drop", (event) => {
  importWorkbook(event.dataTransfer.files[0]);
});

elements.attachmentButton.addEventListener("click", () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener("change", () => {
  chooseAttachment(elements.attachmentInput.files[0]);
});
elements.removeAttachment.addEventListener("click", () => {
  attachment = null;
  elements.attachmentInput.value = "";
  elements.attachmentSummary.classList.add("hidden");
  elements.attachmentButton.textContent = "Add attachment";
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAlert("");

  if (!elements.form.reportValidity()) return;
  if (!elements.editor.textContent.trim()) {
    showAlert("Enter the email content.");
    elements.editor.focus();
    return;
  }
  if (!recipients.length || recipients.length > MAX_RECIPIENTS) {
    showAlert(`Import between 1 and ${MAX_RECIPIENTS} valid recipients.`);
    return;
  }
  if (
    !window.confirm(
      `Send this email one by one to ${recipients.length} recipient${
        recipients.length === 1 ? "" : "s"
      }?`,
    )
  ) {
    return;
  }

  isSending = true;
  updateSendButton();
  elements.form.setAttribute("aria-busy", "true");
  elements.progressCard.classList.remove("hidden");
  elements.cancelButton.disabled = false;
  elements.progressCard.scrollIntoView({ behavior: "smooth", block: "start" });
  updateProgress({
    status: "queued",
    total: recipients.length,
    processed: 0,
    success: 0,
    failed: 0,
    results: [],
  });

  const data = new FormData();
  data.append("provider", elements.provider.value);
  data.append("senderEmail", elements.senderEmail.value.trim());
  data.append("appPassword", elements.appPassword.value.trim());
  data.append("subject", elements.subject.value.trim());
  data.append("html", elements.editor.innerHTML);
  data.append("recipients", JSON.stringify(recipients));
  if (attachment) data.append("attachment", attachment);

  try {
    const campaign = await fetch("/api/campaigns", { method: "POST", body: data }).then(
      responseJson,
    );
    campaignId = campaign.id;
    watchCampaign(campaign.id);
  } catch (error) {
    finishCampaign({ status: "error", error: error.message });
    elements.progressMessage.textContent = error.message;
  }
});

elements.cancelButton.addEventListener("click", async () => {
  if (!campaignId) return;
  elements.cancelButton.disabled = true;
  try {
    await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/cancel`, {
      method: "POST",
    }).then(responseJson);
  } catch (error) {
    showAlert(error.message);
    elements.cancelButton.disabled = false;
  }
});

updateSendButton();
