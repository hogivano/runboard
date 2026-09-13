/** Dashboard UI. Polls the API, keeps one detail pane mounted and never clobbers user input. */

const STATUS_LABELS = {
  running: "Running",
  needs_input: "Needs input",
  blocked: "Blocked",
  ready_for_manager_review: "Ready for review",
  completed: "Completed",
  failed: "Failed",
  stale: "Stale",
  unknown: "Unknown",
};

const POLL_MS = 3000;

const el = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

/**
 * Agents write report summaries as a single JSON string and often escape their line
 * breaks, so the text arrives with literal "\n" in it and reads as one wall of prose.
 * Restore the breaks for display only — the document viewer still shows report.json
 * exactly as written.
 */
const readable = (text) => String(text ?? "").replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "  ");

/** Feedback text the user has typed but not sent, kept per run across polls and selections. */
const drafts = new Map();
/** What the server tells the UI about itself: title, task-source name, whether it can launch. */
let settings = { title: "runboard", sourceLabel: "task", canLaunch: false };
const importLabel = () => `${settings.sourceLabel} import`;

let selectedId = null;
let shell = null;
/** Latest open-question list, so the detail pane can show the question inline. */
let openQuestions = [];

// ------------------------------------------------------------------- api

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

const postJson = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const runPath = (id, action = "") => `/api/runs/${encodeURIComponent(id)}${action}`;

function notify(node, message, kind) {
  node.textContent = message;
  node.className = `notice ${kind}`;
}

// ------------------------------------------------------------------ list

function statusPill(status) {
  return `<span class="pill ${esc(status)}">${esc(STATUS_LABELS[status] ?? status)}</span>`;
}

function renderSummary(runs) {
  // Imports are counted separately: they are task reads, not pipeline runs,
  // and mixing them made every card read higher than the real workload.
  const pipelines = runs.filter((run) => run.kind === "pipeline");
  const count = (...statuses) => pipelines.filter((run) => statuses.includes(run.status)).length;
  const cards = [
    ["Runs", pipelines.length],
    ["Active", count("running")],
    ["Needs input", count("needs_input", "blocked")],
    ["Ready for review", count("ready_for_manager_review")],
    ["Calls", pipelines.reduce((total, run) => total + (run.stageCalls || 0), 0)],
    ["Loose imports", runs.length - pipelines.length],
  ];
  el("summary").innerHTML = cards
    .map(([label, value]) =>
      `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");
}

function renderRunList(runs) {
  if (runs.length === 0) {
    el("run-list").innerHTML = '<p class="muted">No runs yet.</p>';
    return;
  }
  el("run-list").innerHTML = runs
    .map((run) => {
      const folded = run.importIds.length ? ` · ${run.importIds.length} import(s)` : "";
      const stage = run.activeStage ?? (run.kind === "import" ? importLabel() : "—");
      return `<button type="button" class="run" data-id="${esc(run.id)}" aria-current="${
        run.id === selectedId
      }">
        <span class="run-name">${esc(run.label)}</span><br>
        <small>${esc(run.id)}</small><br>
        <small>${esc(stage)}${esc(folded)}</small> ${statusPill(run.status)}
      </button>`;
    })
    .join("");
}

// -------------------------------------------------------------- questions

function renderQuestions(questions) {
  const panel = el("questions-panel");
  panel.hidden = questions.length === 0;
  if (!questions.length) return;
  el("questions-count").textContent = questions.length;
  el("questions").innerHTML = questions
    .map((question) => {
      const who = [question.role, question.stage].filter(Boolean).join(" · ") || "team";
      const answered = question.answered ? ' <span class="pill">answer recorded</span>' : "";
      return `<button type="button" class="question" data-id="${esc(question.runId)}">
        <span class="question-head">${esc(question.label)} — ${esc(who)} ${
        statusPill(question.status)
      }${answered}</span>
        <span class="question-detail">${
        esc(question.reason || question.detail || "No detail recorded.")
      }</span>
      </button>`;
    })
    .join("");
}

// ---------------------------------------------------------------- detail

/** Stages come from the server: the run's own history plus any configured stage order. */
function stageGraph(run) {
  if (run.kind === "import") {
    return `<div class="stage ${esc(run.status)}"><b>${esc(importLabel())}</b><small>${
      esc(STATUS_LABELS[run.status] ?? run.status)
    }</small></div>`;
  }
  if (!run.stages.length) return '<p class="muted">No stages recorded yet.</p>';
  return run.stages.map((stage) => {
    const diff = stage.diffStat ? `<br>${esc(stage.diffStat)}` : "";
    const artifacts = stage.artifacts.length ? `<br>${esc(stage.artifacts.join(", "))}` : "";
    return `<div class="stage ${esc(stage.status)}"><b>${esc(stage.label)}</b><small>${
      esc(stage.status)
    }${diff}${artifacts}</small></div>`;
  }).join("");
}

function eventList(run) {
  if (!run.events.length) return '<p class="muted">No activity recorded yet.</p>';
  return run.events
    .slice()
    .reverse()
    .map((event) => {
      const time = new Date(event.time);
      const stamp = Number.isNaN(time.valueOf()) ? "" : time.toLocaleTimeString();
      return `<div class="event"><time>${esc(stamp)}</time>${esc(event.message)}</div>`;
    })
    .join("");
}

/** Lists a run's agent documents; the body is fetched only when one is opened. */
async function loadDocuments(id) {
  const list = shell.documentList;
  let documents;
  try {
    documents = await api(runPath(id, "/documents"));
  } catch (error) {
    list.innerHTML = `<p class="notice error">${esc(error.message)}</p>`;
    return;
  }
  if (!documents.length) {
    list.innerHTML = '<p class="muted">No documents yet.</p>';
    return;
  }
  list.innerHTML = documents
    .map((doc) => {
      const where = doc.source === "workspace"
        ? "worktree note"
        : [doc.role, doc.stage].filter(Boolean).join(" · ") || "run";
      const size = `${Math.max(1, Math.round(doc.size / 1024))} KB`;
      return `<button type="button" class="document" data-doc="${esc(doc.id)}"
        aria-current="false" ${doc.readable ? "" : "disabled"}>
        ${esc(doc.name)}<small>${esc(where)} · ${size}</small>
      </button>`;
    })
    .join("");
}

async function openDocument(id, documentId, button) {
  for (const node of shell.documentList.querySelectorAll(".document")) {
    node.setAttribute("aria-current", String(node === button));
  }
  shell.documentTitle.textContent = "Loading…";
  shell.documentContent.hidden = true;
  try {
    const doc = await api(runPath(id, `/documents/${documentId}`));
    shell.documentTitle.textContent = doc.truncated
      ? `${doc.name} — showing the first part of ${Math.round(doc.size / 1024)} KB`
      : doc.name;
    shell.documentContent.textContent = doc.content;
    shell.documentContent.hidden = false;
  } catch (error) {
    shell.documentTitle.textContent = error.message;
  }
}

/** Mounts the detail pane once per selected run so polling cannot reset the form. */
function mountShell(id) {
  const fragment = el("detail-template").content.cloneNode(true);
  // Fail loudly when the template and this file drift apart, instead of surfacing
  // later as a null dereference inside an event-handler binding.
  const field = (name) => {
    const node = fragment.querySelector(`[data-field="${name}"]`);
    if (!node) throw new Error(`Detail template is missing [data-field="${name}"]`);
    return node;
  };
  const next = {
    id,
    title: field("title"),
    meta: field("meta"),
    reason: field("reason"),
    graph: field("graph"),
    events: field("events"),
    files: field("files"),
    form: field("feedback-form"),
    retry: field("retry"),
    send: field("send"),
    notice: field("notice"),
    questionPanel: field("question-panel"),
    questionTitle: field("question-title"),
    questionDetail: field("question-detail"),
    replyTitle: field("reply-title"),
    replyPanel: null,
    replayWarning: field("replay-warning"),
    documentList: field("document-list"),
    documentTitle: field("document-title"),
    documentContent: field("document-content"),
  };
  next.replyPanel = next.replyTitle.closest(".panel");
  next.textarea = next.form.elements.feedback;
  next.repo = next.form.elements.repo;
  next.refresh = next.form.elements.refreshTask;
  field("refresh-label").textContent = `Re-read the ${settings.sourceLabel} task (extra agent call)`;
  if (!settings.canLaunch) {
    next.send.hidden = true;
    next.retry.hidden = true;
    next.refresh.closest("label").hidden = true;
    next.repo.hidden = true;
  }
  next.textarea.value = drafts.get(id) ?? "";
  next.textarea.addEventListener("input", () => drafts.set(id, next.textarea.value));

  /** Records the answer, and optionally re-runs the team carrying it. */
  const reply = async (relaunch) => {
    const button = relaunch ? next.send : next.form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await postJson(runPath(id, "/reply"), {
        answer: next.textarea.value,
        relaunch,
        repo: next.repo.value,
        refreshTask: next.refresh.checked,
      });
      drafts.delete(id);
      next.textarea.value = "";
      // `delivered` distinguishes an answer an agent will read from one only on disk.
      notify(next.notice, result.delivery, result.delivered ? "ok" : "warn");
      await loadSettings().then(refresh);
    } catch (error) {
      notify(next.notice, error.message, "error");
    } finally {
      button.disabled = false;
    }
  };

  next.form.addEventListener("submit", (event) => {
    event.preventDefault();
    reply(false);
  });
  next.send.addEventListener("click", () => reply(true));

  next.documentList.addEventListener("click", (event) => {
    const button = event.target.closest(".document");
    if (button) openDocument(id, button.dataset.doc, button);
  });

  next.retry.addEventListener("click", async () => {
    next.retry.disabled = true;
    try {
      const result = await postJson(runPath(id, "/retry"), {
        feedback: next.textarea.value,
        repo: next.repo.value,
        refreshTask: next.refresh.checked,
      });
      notify(next.notice, `Retry started (pid ${result.pid}) with a fresh worktree.`, "ok");
      await refresh();
    } catch (error) {
      notify(next.notice, error.message, "error");
    } finally {
      next.retry.disabled = false;
    }
  });

  const detail = el("detail");
  detail.replaceChildren(fragment);
  shell = next;
  loadDocuments(id);
}

function renderDetail(run) {
  if (!shell || shell.id !== run.id) mountShell(run.id);
  shell.title.innerHTML = `${esc(run.label)} ${statusPill(run.status)}`;
  const chars = (run.runnerPromptChars || 0).toLocaleString();
  shell.meta.textContent = [
    run.id,
    run.workspace ?? (run.kind === "import" ? importLabel() : "no workspace"),
    `${run.stageCalls || 0} calls`,
    `${chars} prompt chars`,
    run.startedAt ? `started ${new Date(run.startedAt).toLocaleString()}` : null,
  ].filter(Boolean).join(" · ");

  shell.reason.hidden = !run.reason;
  shell.reason.textContent = run.reason ?? "";
  shell.graph.innerHTML = stageGraph(run);
  shell.events.innerHTML = eventList(run);
  shell.files.textContent = run.files.length ? run.files.join(" · ") : "None yet.";

  shell.repo.placeholder = run.repository
    ? `Defaults to ${run.repository}`
    : "Repository path (required — this run did not record one)";
  shell.retry.disabled = !run.retryable;
  shell.retry.title = run.retryBlockedReason ?? "";
  shell.form.hidden = run.kind === "import";

  const question = openQuestions.find((item) => item.runId === run.id);
  shell.questionPanel.hidden = !question;
  // When an agent is waiting, answering is the job: put the question and the reply box
  // above the stage graph so it does not sit a screen and a half down the page.
  const detail = el("detail");
  if (question && detail.firstElementChild !== shell.questionPanel) {
    detail.prepend(shell.questionPanel, shell.replyPanel);
  }
  if (question) {
    const who = [question.role, question.stage].filter(Boolean).join(" · ") || "the team";
    shell.questionTitle.textContent = `${who} is waiting on you`;
    // `reason` is a Python exception string and is shown verbatim; only the agent's
    // own summary carries the escaped newlines that need restoring.
    shell.questionDetail.textContent = question.reason || readable(question.detail) ||
      "No detail recorded.";
    shell.replyTitle.textContent = "Answer the team";
    // The run has exited, so say plainly what answering costs before the click.
    shell.replayWarning.textContent = question.replays.length
      ? `This run has stopped. Answering re-runs the team from the start, replaying: ${
        question.replays.join(", ")
      }.`
      : "This run has stopped. Answering starts a fresh run carrying your answer.";
  } else {
    shell.replyTitle.textContent = "Reply to the team";
    shell.replayWarning.textContent = run.status === "running"
      ? "This run is live; a recorded answer is picked up when it builds the next stage prompt."
      : "This run is not waiting on a question. A recorded answer is only read if you re-run the team.";
  }
}

async function loadDetail() {
  if (!selectedId) return;
  try {
    renderDetail(await api(runPath(selectedId)));
  } catch (error) {
    el("detail").innerHTML = `<div class="panel notice error">${esc(error.message)}</div>`;
    shell = null;
  }
}

// ------------------------------------------------------------------ wiring

async function loadSettings() {
  try {
    settings = await api("/api/config");
  } catch {
    // Keep the defaults; the rest of the dashboard still works.
  }
  document.title = settings.title;
  el("app-title").textContent = settings.title;
  el("start-title").textContent = `Start from ${settings.sourceLabel}`;
  el("start-form").elements.task.placeholder = `${settings.sourceLabel} URL or ID`;
  // Without a launcher nothing can be started; say so instead of offering a dead form.
  el("start-panel").hidden = !settings.canLaunch;
}

async function refresh() {
  try {
    const [runs, questions] = await Promise.all([api("/api/runs"), api("/api/questions")]);
    openQuestions = questions;
    renderSummary(runs);
    renderQuestions(questions);
    renderRunList(runs);
    await loadDetail();
  } catch (error) {
    // The start panel can be hidden (no launcher), so polling errors get their own line.
    notify(el("app-notice"), error.message, "error");
  }
}

el("run-list").addEventListener("click", (event) => {
  const button = event.target.closest(".run");
  if (!button) return;
  selectedId = button.dataset.id;
  for (const node of el("run-list").querySelectorAll(".run")) {
    node.setAttribute("aria-current", String(node.dataset.id === selectedId));
  }
  loadDetail();
});

el("questions").addEventListener("click", (event) => {
  const button = event.target.closest(".question");
  if (!button) return;
  selectedId = button.dataset.id;
  for (const node of el("run-list").querySelectorAll(".run")) {
    node.setAttribute("aria-current", String(node.dataset.id === selectedId));
  }
  loadDetail().then(() => shell?.textarea?.focus());
});

el("start-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const notice = el("start-notice");
  try {
    const result = await postJson("/api/start", {
      task: form.elements.task.value,
      repo: form.elements.repo.value,
    });
    notify(notice, `Team started (pid ${result.pid}).`, "ok");
    form.reset();
    await refresh();
  } catch (error) {
    notify(notice, error.message, "error");
  }
});

el("refresh").addEventListener("click", refresh);
setInterval(() => {
  if (!document.hidden) refresh();
}, POLL_MS);
refresh();
