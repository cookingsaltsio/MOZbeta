"use strict";

const APP_VERSION = "moz-lite-0.1.0";
const DEFAULT_DELIMITERS = "。！？!?．.：:";
const DETECTABLE_DELIMITERS = "。！？!?．.：:；;｡…";
const CLOZE_RE = /\{\{c(\d+)::([^:}]+)(?:::([^}]+))?\}\}/g;
const EXPORT_COLUMNS = [
  "question",
  "answer",
  "choice1",
  "choice2",
  "choice3",
  "choice4",
  "correct",
  "choice_exclude_words",
  "choice_group",
  "choice1_explanation",
  "choice2_explanation",
  "choice3_explanation",
  "choice4_explanation",
  "explanation",
  "source",
  "tts_text",
  "tts_lang",
  "tts_auto",
  "example_tts",
  "example_tts_lang"
];
const CHOICE_CIRCLED_MARKERS = "①②③④";
const CHOICE_FILLED_MARKERS = "❶❷❸❹";
const CHOICE_MARKER_TOKEN_PATTERN = String.raw`[①②③④❶❷❸❹]|[（(]\s*[1-4１-４A-Da-dＡ-Ｄａ-ｄ]\s*[)）]|[1-4１-４A-Da-dＡ-Ｄａ-ｄ]\s*[.．、,)]?|[ⅠⅡⅢⅣⅰⅱⅲⅳ]\s*[.．、,)]?`;
const ANSWER_SECTION_RE = /\n\s*(答案|参考答案|正解|答え)\s*[:：]?/;

const state = {
  mode: "vocab",
  activePane: "text1",
  pendingLoadPane: "text1",
  cards: [],
  undo: [],
  expandedRows: new Set(),
  findMatches: [],
  findIndex: -1,
  draggedIndex: -1,
  createdAt: new Date().toISOString()
};

const el = {
  text1: document.getElementById("text1"),
  text2: document.getElementById("text2"),
  clozeDraftGutter: document.getElementById("cloze-draft-gutter"),
  text1Title: document.getElementById("text1-title"),
  text2Title: document.getElementById("text2-title"),
  text1Info: document.getElementById("text1-info"),
  text2Info: document.getElementById("text2-info"),
  shortcutLine: document.getElementById("shortcut-line"),
  loadText1Button: document.getElementById("load-text1-button"),
  loadText2Button: document.getElementById("load-text2-button"),
  cleanText1Button: document.getElementById("clean-text1-button"),
  cleanText2Button: document.getElementById("clean-text2-button"),
  formatText1Button: document.getElementById("format-text1-button"),
  formatText2Button: document.getElementById("format-text2-button"),
  clozeCardLock: document.getElementById("cloze-card-lock-input"),
  choiceMarkerCustom: document.getElementById("choice-marker-custom"),
  choiceQuestionMarker: document.getElementById("choice-question-marker"),
  choiceAnswerSequence: document.getElementById("choice-answer-sequence"),
  draftTitle: document.getElementById("draft-title"),
  modeHint: document.getElementById("mode-hint"),
  vocabDraft: document.getElementById("vocab-draft"),
  draftQ: document.getElementById("draft-question"),
  draftA: document.getElementById("draft-answer"),
  draftExcludes: document.getElementById("draft-excludes"),
  draftGroup: document.getElementById("draft-group"),
  delimiter: document.getElementById("delimiter-input"),
  cardsBody: document.getElementById("cards-body"),
  cardCount: document.getElementById("card-count"),
  status: document.getElementById("status-text"),
  sourceFile: document.getElementById("source-file-input"),
  workFile: document.getElementById("work-file-input"),
  findbar: document.getElementById("findbar"),
  findInput: document.getElementById("find-input"),
  findScope: document.getElementById("find-scope"),
  findCount: document.getElementById("find-count"),
  sourceLock: document.getElementById("source-lock-input")
};

function setStatus(message) {
  el.status.textContent = message;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function isTruthyValue(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return ["true", "1", "yes", "y", "on", "はい", "有効", "enabled"].includes(String(value).trim().toLowerCase());
}

function normalizeOptionalText(value) {
  if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean).join("、");
  return String(value || "").trim();
}

function normalizeChoiceExplanations(value) {
  let items = [];
  if (Array.isArray(value)) {
    items = value;
  } else {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (text) items = text.includes("\n---\n") ? text.split(/\n---\n/g) : text.split(/[|｜\n]+/g);
  }
  const normalized = items.map(item => String(item || "").trim()).slice(0, 4);
  while (normalized.length < 4) normalized.push("");
  return normalized;
}

function normalizeCardData(card = {}) {
  const kind = card.kind === "cloze" ? "cloze" : card.kind === "choice" ? "choice" : "vocab";
  const rawChoices = Array.isArray(card.choices)
    ? card.choices
    : Array.isArray(card.fixedChoices)
      ? card.fixedChoices
      : Array.isArray(card.fixed_choices)
        ? card.fixed_choices
        : [];
  const choices = rawChoices.map(choice => String(choice || "").trim()).slice(0, 4);
  while (choices.length < 4) choices.push("");

  const normalized = {
    ...card,
    kind,
    q: String(card.q || ""),
    a: String(card.a || ""),
    choiceExcludeWords: normalizeOptionalText(card.choiceExcludeWords || card.choice_exclude_words || card.choiceExcludes || card.excludeWords || ""),
    choiceGroup: normalizeOptionalText(card.choiceGroup || card.choice_group || ""),
    fixedChoiceExplanations: normalizeChoiceExplanations(
      card.fixedChoiceExplanations || card.fixed_choice_explanations || card.choiceExplanations || card.choice_explanations || []
    ),
    explanation: normalizeOptionalText(card.explanation || card.note || card.commentary || ""),
    source: normalizeOptionalText(card.source || card.reference || ""),
    ttsText: normalizeOptionalText(card.ttsText || card.tts_text || ""),
    ttsLang: normalizeOptionalText(card.ttsLang || card.tts_lang || ""),
    ttsAuto: isTruthyValue(card.ttsAuto !== undefined ? card.ttsAuto : card.tts_auto),
    exampleTts: normalizeOptionalText(card.exampleTts || card.example_tts || ""),
    exampleTtsLang: normalizeOptionalText(card.exampleTtsLang || card.example_tts_lang || "")
  };
  if (kind === "choice" || rawChoices.length) normalized.choices = choices;
  delete normalized.fixedChoices;
  delete normalized.options;
  delete normalized.choiceExcludes;
  delete normalized.excludeWords;
  delete normalized.choice_exclude_words;
  delete normalized.choice_group;
  delete normalized.fixed_choices;
  delete normalized.fixed_choice_explanations;
  delete normalized.choiceExplanations;
  delete normalized.choice_explanations;
  delete normalized.note;
  delete normalized.commentary;
  delete normalized.reference;
  delete normalized.tts_text;
  delete normalized.tts_lang;
  delete normalized.tts_auto;
  delete normalized.example_tts;
  delete normalized.example_tts_lang;
  return normalized;
}

function normalizeCards(cards = []) {
  return (Array.isArray(cards) ? cards : []).map(card => normalizeCardData(card));
}

function cloneCards(cards = state.cards) {
  return JSON.parse(JSON.stringify(normalizeCards(cards)));
}

function pushUndo() {
  state.undo.push(JSON.stringify({
    mode: state.mode,
    cards: state.cards,
    text2: el.text2.value,
    text2Info: el.text2Info.textContent,
    draftQ: el.draftQ.value,
    draftA: el.draftA.value,
    draftExcludes: el.draftExcludes.value,
    draftGroup: el.draftGroup.value,
    clozeCardLock: el.clozeCardLock.checked,
    choiceMarkerCustom: el.choiceMarkerCustom.value,
    choiceQuestionMarker: el.choiceQuestionMarker.value,
    choiceAnswerSequence: el.choiceAnswerSequence.value
  }));
  if (state.undo.length > 80) state.undo.shift();
}

function undo() {
  const snapshot = state.undo.pop();
  if (!snapshot) {
    setStatus("取り消す操作がありません");
    return;
  }
  const data = JSON.parse(snapshot);
  state.cards = normalizeCards(data.cards);
  if (typeof data.text2 === "string") el.text2.value = data.text2;
  if (typeof data.text2Info === "string") el.text2Info.textContent = data.text2Info;
  el.draftQ.value = data.draftQ || "";
  el.draftA.value = data.draftA || "";
  el.draftExcludes.value = data.draftExcludes || "";
  el.draftGroup.value = data.draftGroup || "";
  el.clozeCardLock.checked = data.clozeCardLock !== false;
  el.choiceMarkerCustom.value = data.choiceMarkerCustom || "";
  el.choiceQuestionMarker.value = data.choiceQuestionMarker || "";
  el.choiceAnswerSequence.value = data.choiceAnswerSequence || "";
  setMode(["cloze", "choice"].includes(data.mode) ? data.mode : "vocab", { silent: true });
  renderCards();
  setStatus("直前の操作を取り消しました");
}

function activeTextarea() {
  return state.activePane === "text2" ? el.text2 : el.text1;
}

function selectedTextFrom(source) {
  return source.value.slice(source.selectionStart, source.selectionEnd).trim();
}

function selectedSourceText() {
  return selectedTextFrom(activeTextarea());
}

function setActivePane(paneId) {
  state.activePane = paneId === "text2" ? "text2" : "text1";
  document.querySelectorAll(".source-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.pane === state.activePane);
  });
}

function setMode(mode, options = {}) {
  state.mode = ["cloze", "choice"].includes(mode) ? mode : "vocab";
  document.querySelectorAll("input[name='builder-mode']").forEach((input) => {
    input.checked = input.value === state.mode;
  });
  const cloze = state.mode === "cloze";
  const choice = state.mode === "choice";
  document.body.classList.toggle("mode-cloze", cloze);
  document.body.classList.toggle("mode-choice", choice);
  el.vocabDraft.hidden = cloze || choice;
  el.draftTitle.textContent = cloze ? "穴埋め作成" : choice ? "4択作成" : "単語帳draft";
  el.modeHint.textContent = cloze
    ? "元本文でA=カード追加、一覧の問題欄で1-9=Cloze化"
    : choice
      ? "4択問題テキストを貼り付け、答え欄または本文末の答案を使ってカード化"
    : "A/Sで候補を入れてDでカード化";
  el.shortcutLine.textContent = cloze
    ? "穴埋め: 元本文でA=穴埋めカード追加 / 問題文ロックON時、一覧の穴埋めカード問題欄で1-9=穴埋め化　共通: Z=取消 / Ctrl+F=検索 / Ctrl+S=作業保存"
    : choice
      ? "4択: 問題テキストを貼り付け / 問題番号・4択番号・答えまたは答案セクションを設定 / 4択をカード化　共通: Z=取消 / Ctrl+F=検索 / Ctrl+S=作業保存"
    : "単語帳: A=問題draft / S=解答draft / D=追加　共通: Z=取消 / X=draftクリア / Ctrl+F=検索 / Ctrl+S=作業保存";
  el.text1Title.textContent = cloze ? "元本文" : choice ? "4択問題テキスト" : "テキスト1";
  el.text2Title.textContent = "テキスト2";
  el.text1.placeholder = cloze
    ? "穴埋め問題の元になる本文を貼り付けます。文を選択してAで作成済みカード一覧へ追加します。"
    : choice
      ? "4択問題のテキストを貼り付けます。(1)などの問題番号や①②/❶❷といった選択肢番号が、改行・スペース・タブで分かれていても、順番が正しければ自動でカード化できます。答えは上部の答え欄に 4212441234 のように羅列するか、本文末に 答案 / 正解 / 答え セクションを付けてください。"
    : "ここに本文を貼り付けるか、テキスト1読込を使います。";
  el.text2.placeholder = cloze
    ? "穴埋めモードではテキスト2を使いません。元本文からカード一覧へ直接追加します。"
    : "対訳、解答側本文、別資料などを貼り付けます。";
  el.text2.setAttribute("wrap", cloze ? "off" : "soft");
  el.loadText2Button.disabled = cloze || choice;
  el.loadText1Button.textContent = cloze ? "元本文読込" : choice ? "4択テキスト読込" : "テキスト1読込";
  el.loadText2Button.title = cloze ? "穴埋めモードではテキスト2を使いません" : choice ? "4択モードでは4択問題テキストだけを使います" : "";
  el.cleanText1Button.textContent = cloze ? "元本文整理" : choice ? "4択テキスト整理" : "テキスト1整理";
  el.cleanText2Button.textContent = "テキスト2整理";
  el.formatText1Button.textContent = cloze ? "元本文整形" : choice ? "4択テキスト整形" : "テキスト1整形";
  el.formatText2Button.textContent = "テキスト2整形";
  el.formatText2Button.disabled = cloze || choice;
  el.formatText2Button.title = cloze || choice ? "このモードでは2つ目のテキスト欄を使いません" : "";
  el.cleanText2Button.disabled = cloze || choice;
  el.cleanText2Button.title = cloze || choice ? "このモードでは2つ目のテキスト欄を使いません" : "";
  const text1Option = el.findScope.querySelector('option[value="text1"]');
  const text2Option = el.findScope.querySelector('option[value="text2"]');
  if (text1Option) text1Option.textContent = cloze ? "元本文" : choice ? "4択問題テキスト" : "テキスト1";
  if (text2Option) text2Option.textContent = "テキスト2";
  if ((cloze || choice) && state.activePane === "text2") setActivePane("text1");
  applySourceLock({ silent: true });
  updateClozeDraftGutter();
  if (!options.silent) setStatus(cloze ? "穴埋めモードに切り替えました" : choice ? "4択モードに切り替えました" : "単語帳モードに切り替えました");
}

function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n?/g, "\n");
}

function cleanMaterialText(text) {
  return normalizeNewlines(text)
    .replace(/^\uFEFF/, "")
    .replace(/[​﻿]/g, "")
    .replace(/［＃[^］]*］/g, "")
    .replace(/｜/g, "")
    .replace(/《[^》]*》/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("script,style,noscript,iframe,svg,canvas,template").forEach((node) => node.remove());
  return doc.body ? doc.body.innerText : doc.documentElement.textContent || "";
}

function uniqueChars(text) {
  return [...new Set(Array.from(text || ""))].join("");
}

function delimiterTextFor() {
  const configured = el.delimiter.value.trim();
  return uniqueChars(configured || DEFAULT_DELIMITERS);
}

function splitDisplayText(text, delimitersText = "") {
  const delimiters = [...new Set(Array.from(delimitersText || delimiterTextFor()))];
  const delimiterSet = new Set(delimiters);
  const lines = [];
  let current = "";
  for (const ch of normalizeNewlines(text)) {
    current += ch;
    if (delimiterSet.has(ch) || ch === "\n") {
      const line = current.trim();
      if (line) lines.push(line);
      current = "";
    }
  }
  const rest = current.trim();
  if (rest) lines.push(rest);
  return lines.join("\n");
}

function lineCount(text) {
  return String(text || "").split("\n").filter((line) => line.trim()).length;
}

function paneLabel(paneId) {
  if (paneId === "text2") return "テキスト2";
  if (state.mode === "choice") return "4択問題テキスト";
  return state.mode === "cloze" ? "元本文" : "テキスト1";
}

function updatePaneInfo(paneId, message) {
  const info = paneId === "text2" ? el.text2Info : el.text1Info;
  info.textContent = message;
}

function syncClozeDraftGutterScroll() {
  if (!el.clozeDraftGutter) return;
  el.clozeDraftGutter.scrollTop = el.text2.scrollTop;
}

function updateClozeDraftGutter() {
  if (!el.clozeDraftGutter) return;
  const text = String(el.text2.value || "");
  const count = text ? text.split("\n").length : 0;
  el.clozeDraftGutter.innerHTML = Array.from({ length: count }, (_, index) => `<div>${index + 1}</div>`).join("");
  syncClozeDraftGutterScroll();
}

function cleanSourcePane(paneId) {
  const box = paneId === "text2" ? el.text2 : el.text1;
  if (!box.value.trim()) {
    setStatus(`${paneLabel(paneId)} は空です`);
    return false;
  }
  box.value = cleanMaterialText(box.value);
  updatePaneInfo(paneId, `整理済み / ${lineCount(box.value)}行`);
  if (paneId === "text2") updateClozeDraftGutter();
  return true;
}

function cleanSources(scope) {
  if (scope === "both") {
    const done1 = cleanSourcePane("text1");
    const done2 = cleanSourcePane("text2");
    if (done1 || done2) setStatus("ルビ記号・注記・特殊記号を整理しました");
    return;
  }
  if (cleanSourcePane(scope)) {
    setActivePane(scope);
    setStatus(`${paneLabel(scope)} を整理しました`);
  }
}

function formatSourcePane(paneId, options = {}) {
  const box = paneId === "text2" ? el.text2 : el.text1;
  if (!box.value.trim()) {
    setStatus(`${paneLabel(paneId)} は空です`);
    return false;
  }
  const delimiters = options.delimiters || delimiterTextFor();
  box.value = splitDisplayText(cleanMaterialText(box.value), delimiters);
  updatePaneInfo(paneId, `整形済み / ${lineCount(box.value)}行 / 区切り: ${delimiters}`);
  if (paneId === "text2") updateClozeDraftGutter();
  return true;
}

function formatSources(scope) {
  if (scope === "both") {
    const delimiters = delimiterTextFor();
    const done1 = formatSourcePane("text1", { delimiters });
    const done2 = formatSourcePane("text2", { delimiters });
    if (done1 || done2) setStatus(`テキストを文ごとに整形しました（区切り: ${delimiters}）`);
    return;
  }
  if (formatSourcePane(scope)) {
    setActivePane(scope);
    setStatus(`${paneLabel(scope)} を文ごとに整形しました`);
  }
}

function sourceTextForScope(scope) {
  if (scope === "text1") return el.text1.value;
  if (scope === "text2") return el.text2.value;
  return `${el.text1.value}\n${el.text2.value}`;
}

function detectDelimiterCandidates() {
  const source = sourceTextForScope(state.activePane);
  const detected = uniqueChars(Array.from(DETECTABLE_DELIMITERS).filter((char) => source.includes(char)).join(""));
  if (!detected) {
    setStatus("本文から区切り文字候補を見つけられませんでした");
    return;
  }
  el.delimiter.value = detected;
  setStatus(`区切り文字候補を設定しました: ${detected}`);
}

function resetDelimiters() {
  el.delimiter.value = DEFAULT_DELIMITERS;
  setStatus("区切り文字を初期値に戻しました");
}

function romanChoiceNumber(token) {
  const map = {
    "Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4,
    "ⅰ": 1, "ⅱ": 2, "ⅲ": 3, "ⅳ": 4
  };
  return map[String(token || "").trim()] || 0;
}

function markerNumberFromToken(token) {
  const raw = String(token || "").trim().replace(/[\s.．。、,):：）]+$/u, "").trim();
  const circledIndex = CHOICE_CIRCLED_MARKERS.indexOf(raw);
  if (circledIndex >= 0) return circledIndex + 1;
  const filledIndex = CHOICE_FILLED_MARKERS.indexOf(raw);
  if (filledIndex >= 0) return filledIndex + 1;
  const roman = romanChoiceNumber(raw);
  if (roman) return roman;
  const normalized = raw.normalize("NFKC").replace(/^[\s(（\[]+/, "").replace(/[\s)）\].．。、,]+$/, "").trim();
  if (/^[1-4]$/.test(normalized)) return parseInt(normalized, 10);
  if (/^[A-Da-d]$/.test(normalized)) return normalized.toUpperCase().charCodeAt(0) - 64;
  return 0;
}

function choiceMarkerPatternForStyle(style) {
  const sourceByStyle = {
    circled: String.raw`([①②③④❶❷❸❹])`,
    digit: String.raw`([1-4])(?=[ \t\u3000]+)`,
    "digit-dot": String.raw`([1-4]\s*[.．])`,
    "digit-paren": String.raw`([（(]\s*[1-4]\s*[)）]|[1-4]\s*[)）])`,
    fullwidth: String.raw`([１-４])(?=[ \t\u3000]+)`,
    "fullwidth-dot": String.raw`([１-４]\s*[.．])`,
    "fullwidth-paren": String.raw`([（(]\s*[１-４]\s*[)）]|[１-４]\s*[)）])`,
    "alpha-upper": String.raw`([A-DＡ-Ｄ]\s*[.．、)）:：]?)(?=[ \t\u3000\n]|$)`,
    "alpha-lower": String.raw`([a-dａ-ｄ]\s*[.．、)）:：]?)(?=[ \t\u3000\n]|$)`,
    roman: String.raw`([ⅠⅡⅢⅣⅰⅱⅲⅳ]\s*[.．、)）:：]?)(?=[ \t\u3000\n]|$)`,
    auto: String.raw`([①②③④❶❷❸❹]|[（(]\s*[1-4１-４]\s*[)）]|[1-4１-４]\s*[.．、)）]|[1-4１-４](?=[ \t\u3000]+)|[A-Da-dＡ-Ｄａ-ｄ]\s*[.．、)）:：]|[ⅠⅡⅢⅣⅰⅱⅲⅳ]\s*[.．、)）:：]?)`
  };
  return sourceByStyle[String(style || "auto")] || sourceByStyle.auto;
}

function findChoiceMarkerCandidates(text, style) {
  const source = String(text || "");
  const markers = [];
  const pattern = choiceMarkerPatternForStyle(style);
  const lineRe = new RegExp(`(^|\\n)([ \\t\\u3000]*)${pattern}`, "g");
  let match;
  while ((match = lineRe.exec(source)) !== null) {
    const prefix = match[1] || "";
    const space = match[2] || "";
    const token = match[3] || "";
    const number = markerNumberFromToken(token);
    if (number >= 1 && number <= 4) {
      markers.push({
        index: match.index + prefix.length,
        length: space.length + token.length,
        number
      });
    }
  }

  if (style === "auto" || style === "circled") {
    const inlineRe = /[①②③④❶❷❸❹]/g;
    while ((match = inlineRe.exec(source)) !== null) {
      markers.push({ index: match.index, length: match[0].length, number: markerNumberFromToken(match[0]) });
    }
  }

  return markers
    .sort((a, b) => a.index - b.index)
    .filter((marker, index, all) => index === 0 || marker.index !== all[index - 1].index);
}

function choiceMarkerRuns(markers) {
  const convert = new Map();
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].number !== 1) continue;
    let expected = 1;
    const run = [];
    for (let j = i; j < markers.length && expected <= 4; j++) {
      if (markers[j].number === expected) {
        run.push(markers[j]);
        expected++;
      } else if (markers[j].number === 1 && expected > 1) {
        break;
      }
    }
    if (run.length >= 2) run.forEach(marker => convert.set(marker.index, marker.number));
  }
  return convert;
}

function splitAnswerSection(text) {
  const match = String(text || "").match(ANSWER_SECTION_RE);
  if (!match) return { body: String(text || ""), answer: "" };
  return {
    body: String(text || "").slice(0, match.index),
    answer: String(text || "").slice(match.index + match[0].length)
  };
}

function normalizeChoiceMarkersText(text, style) {
  const { body, answer } = splitAnswerSection(text);
  const markers = findChoiceMarkerCandidates(body, style);
  const convert = choiceMarkerRuns(markers);
  if (!convert.size) return { text, count: 0 };
  const circled = ["", "①", "②", "③", "④"];
  let cursor = 0;
  let out = "";
  let count = 0;
  markers.forEach(marker => {
    const number = convert.get(marker.index);
    if (!number) return;
    out += body.slice(cursor, marker.index) + circled[number];
    cursor = marker.index + marker.length;
    count++;
  });
  out += body.slice(cursor);
  return { text: out + answer, count };
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function choiceTokenPatternForStyle(style) {
  const sourceByStyle = {
    circled: String.raw`[①②③④❶❷❸❹]`,
    digit: String.raw`[1-4]`,
    "digit-dot": String.raw`[1-4]\s*[.．]`,
    "digit-paren": String.raw`[（(]\s*[1-4]\s*[)）]|[1-4]\s*[)）]`,
    fullwidth: String.raw`[１-４]`,
    "fullwidth-dot": String.raw`[１-４]\s*[.．]`,
    "fullwidth-paren": String.raw`[（(]\s*[１-４]\s*[)）]|[１-４]\s*[)）]`,
    "alpha-upper": String.raw`[A-DＡ-Ｄ]\s*[.．、,)]?`,
    "alpha-lower": String.raw`[a-dａ-ｄ]\s*[.．、,)]?`,
    roman: String.raw`[ⅠⅡⅢⅣⅰⅱⅲⅳ]\s*[.．、,)]?`,
    auto: CHOICE_MARKER_TOKEN_PATTERN
  };
  return sourceByStyle[String(style || "auto")] || sourceByStyle.auto;
}

function customChoiceMarkerTokens(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const compact = raw.normalize("NFKC").replace(/\s+/g, "");
  const joined = compact.match(/^([1-4A-Da-d])([^1-4A-Da-d]+)([1-4A-Da-d])\2([1-4A-Da-d])\2([1-4A-Da-d])$/);
  if (joined) {
    const chars = [joined[1], joined[3], joined[4], joined[5]];
    const sep = joined[2];
    const tokens = chars.map((ch) => ({ token: `${ch}${sep}`, number: markerNumberFromToken(ch) }));
    if (tokens.every((entry, index) => entry.number === index + 1)) return tokens;
  }
  const pattern = new RegExp(CHOICE_MARKER_TOKEN_PATTERN, "g");
  const tokens = [];
  const used = new Set();
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const token = match[0].trim();
    const number = markerNumberFromToken(token);
    if (number >= 1 && number <= 4 && !used.has(number)) {
      tokens.push({ token, number });
      used.add(number);
    }
  }
  return tokens.length >= 2 ? tokens : [];
}

function isCircledChoiceToken(token) {
  return /^[①②③④❶❷❸❹]$/.test(String(token || "").trim());
}

function findLooseChoiceMarkers(text, style, custom) {
  const source = String(text || "");
  const customTokens = customChoiceMarkerTokens(custom);
  const markers = [];
  if (customTokens.length) {
    const alternatives = customTokens
      .map(({ token }) => escapeRegExp(token))
      .sort((a, b) => b.length - a.length)
      .join("|");
    const tokenNumbers = new Map(customTokens.map(({ token, number }) => [token.replace(/\s+/g, ""), number]));
    const addMarker = (index, token, end) => {
      const compact = token.replace(/\s+/g, "");
      const number = tokenNumbers.get(compact) || markerNumberFromToken(token);
      if (number >= 1 && number <= 4) markers.push({ index, end, number });
    };
    if (customTokens.some(({ token }) => isCircledChoiceToken(token))) {
      const inlineRe = new RegExp(alternatives, "g");
      let match;
      while ((match = inlineRe.exec(source)) !== null) addMarker(match.index, match[0], inlineRe.lastIndex);
    }
    const looseRe = new RegExp(`(^|[\\n,，、;；\\t \\u3000])\\s*(${alternatives})\\s*`, "g");
    let match;
    while ((match = looseRe.exec(source)) !== null) {
      const prefix = match[1] || "";
      const token = match[2] || "";
      const index = match.index + prefix.length + (match[0].slice(prefix.length).match(/^\s*/) || [""])[0].length;
      addMarker(index, token, looseRe.lastIndex);
    }
  } else {
    const tokenPattern = choiceTokenPatternForStyle(style);
    if (style === "auto" || style === "circled") {
      const inlineRe = /[①②③④❶❷❸❹]/g;
      let match;
      while ((match = inlineRe.exec(source)) !== null) {
        markers.push({ index: match.index, end: inlineRe.lastIndex, number: markerNumberFromToken(match[0]) });
      }
    }
    const looseRe = new RegExp(`(^|[\\n,，、;；\\t \\u3000])\\s*(${tokenPattern})\\s*`, "g");
    let match;
    while ((match = looseRe.exec(source)) !== null) {
      const prefix = match[1] || "";
      const token = match[2] || "";
      const number = markerNumberFromToken(token);
      if (number >= 1 && number <= 4) {
        const index = match.index + prefix.length + (match[0].slice(prefix.length).match(/^\s*/) || [""])[0].length;
        markers.push({ index, end: looseRe.lastIndex, number });
      }
    }
  }
  return markers
    .sort((a, b) => a.index - b.index)
    .filter((marker, index, all) => index === 0 || marker.index !== all[index - 1].index);
}

function firstChoiceRun(markers) {
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].number !== 1) continue;
    const run = [markers[i]];
    let expected = 2;
    for (let j = i + 1; j < markers.length && expected <= 4; j++) {
      if (markers[j].number === 1 && expected > 2) break;
      if (markers[j].number === expected) {
        run.push(markers[j]);
        expected++;
      }
    }
    if (run.length === 4) return run;
  }
  return null;
}

const QUESTION_MARKERS = "⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇";

function questionNumberFromMarker(token) {
  const raw = String(token || "").trim();
  const circledIndex = QUESTION_MARKERS.indexOf(raw);
  if (circledIndex >= 0) return circledIndex + 1;
  const digits = raw.normalize("NFKC").match(/\d+/);
  return digits ? parseInt(digits[0], 10) : 0;
}

function questionMarkerPatternFromSample(sample) {
  const raw = String(sample || "").trim();
  if (!raw) return String.raw`[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇]|[（(]\s*\d{1,3}\s*[)）]|\d{1,3}\s*[.．、]`;
  if (/[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇]/.test(raw)) return String.raw`[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇]`;
  const normalized = raw.normalize("NFKC");
  if (/[()]/.test(normalized)) return String.raw`[（(]\s*\d{1,3}\s*[)）]`;
  if (/[.．、]/.test(raw)) return String.raw`\d{1,3}\s*[.．、]`;
  return escapeRegExp(raw).replace(/[0-9０-９]+/g, String.raw`\d{1,3}`);
}

function findQuestionMarkers(text, sample) {
  const source = String(text || "");
  const pattern = questionMarkerPatternFromSample(sample);
  const re = new RegExp(`(^|\\n)\\s*(${pattern})\\s*`, "g");
  const markers = [];
  let match;
  while ((match = re.exec(source)) !== null) {
    const prefix = match[1] || "";
    const token = match[2] || "";
    const index = match.index + prefix.length;
    markers.push({
      index,
      end: re.lastIndex,
      number: questionNumberFromMarker(token)
    });
  }
  return markers;
}

function splitChoiceQuestionBlocks(text, questionMarkerSample) {
  const source = normalizeNewlines(text);
  const markers = findQuestionMarkers(source, questionMarkerSample);
  if (!markers.length) return [{ number: 1, text: source.trim() }].filter(block => block.text);
  return markers.map((marker, index) => {
    const next = markers[index + 1];
    return {
      number: marker.number || index + 1,
      text: source.slice(marker.end, next ? next.index : source.length).trim()
    };
  }).filter(block => block.text);
}

function cleanChoicePart(text) {
  return String(text || "")
    .replace(/^[\s,，、;；:：]+/, "")
    .replace(/[\s,，、;；]+$/, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function parseChoiceBlock(blockText) {
  const markers = findLooseChoiceMarkers(blockText, "auto", el.choiceMarkerCustom.value || "");
  const run = firstChoiceRun(markers);
  if (!run) return null;
  const question = cleanChoicePart(blockText.slice(0, run[0].index));
  const choices = run.map((marker, index) => {
    const next = run[index + 1];
    return cleanChoicePart(blockText.slice(marker.end, next ? next.index : blockText.length));
  });
  if (!question || choices.some(choice => !choice)) return null;
  return { question, choices };
}

function parseChoiceAnswerMap(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  const map = new Map();
  if (!source) return map;
  const markerPattern = String.raw`(?:⑴|⑵|⑶|⑷|⑸|⑹|⑺|⑻|⑼|⑽|⑾|⑿|⒀|⒁|⒂|⒃|⒄|⒅|⒆|⒇|[（(]\s*[0-9０-９]{1,3}\s*[)）]|[0-9０-９]{1,3}\s*[、.．:：=-])`;
  const linePattern = String.raw`(?:^|\n)\s*([0-9０-９]{1,3})\s+(${CHOICE_MARKER_TOKEN_PATTERN})`;
  const answerPattern = new RegExp(String.raw`(?:^|[\n,，;；])\s*(${markerPattern})\s*(${CHOICE_MARKER_TOKEN_PATTERN})`, "g");
  const fallbackLinePattern = new RegExp(linePattern, "g");
  let match;
  while ((match = answerPattern.exec(source)) !== null) {
    const questionNo = questionNumberFromMarker(match[1]);
    const answerNo = markerNumberFromToken(match[2]);
    if (questionNo > 0 && answerNo >= 1 && answerNo <= 4) map.set(questionNo, answerNo - 1);
  }
  while ((match = fallbackLinePattern.exec(source)) !== null) {
    const questionNo = questionNumberFromMarker(match[1]);
    const answerNo = markerNumberFromToken(match[2]);
    if (questionNo > 0 && answerNo >= 1 && answerNo <= 4 && !map.has(questionNo)) map.set(questionNo, answerNo - 1);
  }
  return map;
}

function parseChoiceAnswerSequence(value) {
  const raw = splitAnswerSection(String(value || "")).answer || String(value || "").trim();
  if (!raw) return [];
  const compact = raw.normalize("NFKC").replace(/[,\s、，;；/／]+/g, "");
  if (/^[1-4]+$/.test(compact)) return Array.from(compact, ch => parseInt(ch, 10) - 1);
  if (/^[A-Da-d]+$/.test(compact)) return Array.from(compact, ch => ch.toUpperCase().charCodeAt(0) - 65);
  const answers = [];
  const re = new RegExp(CHOICE_MARKER_TOKEN_PATTERN, "g");
  let match;
  while ((match = re.exec(raw)) !== null) {
    const number = markerNumberFromToken(match[0]);
    if (number >= 1 && number <= 4) answers.push(number - 1);
  }
  return answers;
}

function parseChoiceAnswers(value) {
  const raw = String(value || "").trim();
  const answerMap = parseChoiceAnswerMap(raw);
  return {
    map: answerMap,
    sequence: answerMap.size ? [] : parseChoiceAnswerSequence(raw)
  };
}

function choiceLabel(index) {
  return ["①", "②", "③", "④"][index] || "";
}

function formatChoiceCardsPreview(cards) {
  return cards.map((card, index) => {
    const choices = (card.choices || []).map((choice, choiceIndex) => `${choiceLabel(choiceIndex)} ${choice}`).join("\n");
    return `(${index + 1}) ${card.q}\n${choices}`;
  }).join("\n\n");
}

function buildChoiceCardsFromText(options = {}) {
  const sourceWithAnswers = cleanMaterialText(el.text1.value);
  const answerSection = splitAnswerSection(sourceWithAnswers);
  const source = answerSection.body.trim();
  if (!source) {
    setStatus("4択問題テキストが空です");
    return false;
  }
  const blocks = splitChoiceQuestionBlocks(source, el.choiceQuestionMarker.value);
  const manualAnswerText = el.choiceAnswerSequence.value.trim();
  const embeddedAnswerText = answerSection.answer.trim();
  const answerText = manualAnswerText || embeddedAnswerText;
  const parsedAnswers = parseChoiceAnswers(answerText);
  const cards = [];
  const failed = [];
  const invalidAnswers = [];
  const duplicateChoices = [];
  blocks.forEach((block, index) => {
    const parsed = parseChoiceBlock(block.text);
    if (!parsed) {
      failed.push(block.number || index + 1);
      return;
    }
    const blockNumber = block.number || index + 1;
    const answerIndex = parsedAnswers.map.size ? parsedAnswers.map.get(blockNumber) : parsedAnswers.sequence[index];
    if (Number.isInteger(answerIndex) && !parsed.choices[answerIndex]) invalidAnswers.push(blockNumber);
    const normalizedChoices = parsed.choices.map(normalizeChoiceForValidation).filter(Boolean);
    if (new Set(normalizedChoices).size !== normalizedChoices.length) duplicateChoices.push(blockNumber);
    cards.push(normalizeCardData({
      kind: "choice",
      q: parsed.question,
      a: Number.isInteger(answerIndex) && parsed.choices[answerIndex] ? parsed.choices[answerIndex] : "",
      choices: parsed.choices,
      choiceExcludeWords: "",
      choiceGroup: ""
    }));
  });
  if (!cards.length) {
    setStatus("4択カードを作れませんでした。問題番号と4択番号の設定を確認してください");
    return false;
  }
  pushUndo();
  state.cards.push(...cards);
  updatePaneInfo("text1", `4択カード化 / ${cards.length}件`);
  renderCards();
  const missingAnswers = cards.filter(card => !card.a).length;
  const parts = [`4択カードを${cards.length}件追加しました`];
  if (embeddedAnswerText && !manualAnswerText) parts.push("本文内の答案を使用");
  if (!answerText) parts.push("答え未入力");
  if (parsedAnswers.sequence.length && parsedAnswers.sequence.length !== blocks.length) {
    parts.push(`答え数${parsedAnswers.sequence.length}/問題${blocks.length}`);
  }
  if (parsedAnswers.map.size) {
    const blockNumbers = new Set(blocks.map((block, index) => block.number || index + 1));
    const unused = Array.from(parsedAnswers.map.keys()).filter(number => !blockNumbers.has(number));
    if (unused.length) parts.push(`未対応答案: ${unused.join(", ")}`);
  }
  if (missingAnswers) parts.push(`正解未設定${missingAnswers}件`);
  if (invalidAnswers.length) parts.push(`範囲外の答え: ${invalidAnswers.join(", ")}`);
  if (duplicateChoices.length) parts.push(`選択肢重複: ${duplicateChoices.join(", ")}`);
  if (failed.length) parts.push(`解析失敗: ${failed.join(", ")}`);
  setStatus(parts.join(" / "));
  return true;
}

async function decodeFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.slice(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("shift_jis").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

async function loadSourceFile(file, paneId) {
  let text = await decodeFile(file);
  if (/\.html?$/i.test(file.name)) text = stripHtml(text);
  text = cleanMaterialText(text);
  const box = paneId === "text2" ? el.text2 : el.text1;
  box.value = text;
  updatePaneInfo(paneId, `${file.name} / ${lineCount(text)}行`);
  if (paneId === "text2") updateClozeDraftGutter();
  setActivePane(paneId);
  setStatus(`${file.name} を読み込みました`);
}

function applySourceLock(options = {}) {
  const locked = el.sourceLock.checked;
  el.text1.readOnly = locked;
  el.text2.readOnly = locked;
  if (!options.silent) {
    setStatus(locked ? "本文編集ロック中: 選択してショートカットを使えます" : "本文編集ロック解除中: 本文を直接編集できます");
  }
}

function appendSelectionToDraft(source, target) {
  const selected = selectedTextFrom(source);
  if (!selected) {
    setStatus("本文でテキストを選択してください");
    return false;
  }
  pushUndo();
  const box = target === "q" ? el.draftQ : el.draftA;
  box.value = box.value.trim() ? `${box.value.trim()} ${selected}` : selected;
  setStatus(target === "q" ? "問題文draftへ追加しました" : "解答文draftへ追加しました");
  return true;
}

function addSelectionAsClozeCard(source = el.text1) {
  const selected = selectedTextFrom(source);
  if (!selected) {
    setStatus("元本文で穴埋めカードにする文を選択してください");
    return false;
  }
  const item = cleanMaterialText(selected).replace(/\n+/g, " ").trim();
  if (!item) {
    setStatus("追加できる文がありません");
    return false;
  }
  pushUndo();
  state.cards.push(normalizeCardData({
    kind: "cloze",
    q: item,
    a: "",
    choiceExcludeWords: "",
    choiceGroup: ""
  }));
  renderCards();
  setStatus("穴埋めカードを一覧へ追加しました。一覧の問題欄で隠す箇所を選び、1-9を押してください");
  return true;
}

function clearDraft() {
  const hasClozeDraft = false;
  const hasChoiceDraft = state.mode === "choice" && (el.choiceMarkerCustom.value || el.choiceQuestionMarker.value || el.choiceAnswerSequence.value);
  if (!el.draftQ.value && !el.draftA.value && !el.draftExcludes.value && !el.draftGroup.value && !hasClozeDraft && !hasChoiceDraft) return;
  pushUndo();
  el.draftQ.value = "";
  el.draftA.value = "";
  el.draftExcludes.value = "";
  el.draftGroup.value = "";
  if (state.mode === "cloze") {
    setStatus("穴埋めモードにはdraftがありません");
    return;
  }
  if (state.mode === "choice") {
    el.choiceMarkerCustom.value = "";
    el.choiceQuestionMarker.value = "";
    el.choiceAnswerSequence.value = "";
  }
  setStatus("draftをクリアしました");
}

function metadataFromDraft() {
  if (state.mode === "cloze") {
    return { choiceExcludeWords: "", choiceGroup: "" };
  }
  if (state.mode === "choice") {
    return { choiceExcludeWords: "", choiceGroup: "" };
  }
  return {
    choiceExcludeWords: el.draftExcludes.value.trim(),
    choiceGroup: el.draftGroup.value.trim()
  };
}

function cardHasCloze(card) {
  return /\{\{c\d+::[^:}]+(?:::[^}]+)?\}\}/.test(card?.q || "");
}

function textHasCloze(text) {
  return /\{\{c\d+::[^:}]+(?:::[^}]+)?\}\}/.test(String(text || ""));
}

function normalizeChoiceForValidation(value) {
  return String(value || "")
    .replace(/[​﻿]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function cardHasValidChoices(card) {
  const choices = Array.isArray(card?.choices) ? card.choices.map(choice => String(choice || "").trim()) : [];
  const firstFour = choices.slice(0, 4);
  const normalizedChoices = firstFour.map(normalizeChoiceForValidation).filter(Boolean);
  const answer = normalizeChoiceForValidation(card?.a || "");
  return String(card?.q || "").trim()
    && answer
    && firstFour.length >= 4
    && normalizedChoices.length === 4
    && new Set(normalizedChoices).size === 4
    && normalizedChoices.includes(answer);
}

function addVocabCardFromDraft() {
  const q = el.draftQ.value.trim();
  const a = el.draftA.value.trim();
  if (!q || !a) {
    alert("単語帳カードには問題文draftと解答文draftの両方が必要です。");
    return;
  }
  pushUndo();
  state.cards.push(normalizeCardData({
    kind: "vocab",
    q,
    a,
    ...metadataFromDraft()
  }));
  el.draftQ.value = "";
  el.draftA.value = "";
  renderCards();
  setStatus("単語帳カードを追加しました");
}

function addCardFromDraft() {
  if (state.mode === "cloze") {
    setStatus("穴埋めモードでは、元本文で文を選択してAを押してください");
  } else if (state.mode === "choice") {
    buildChoiceCardsFromText();
  } else {
    addVocabCardFromDraft();
  }
}

function addEmptyCard() {
  if (state.mode === "choice") {
    pushUndo();
    state.cards.push(normalizeCardData({
      kind: "choice",
      q: "",
      a: "",
      choices: ["", "", "", ""],
      choiceExcludeWords: "",
      choiceGroup: ""
    }));
    renderCards();
    setStatus("4択の空行を追加しました");
    return;
  }
  if (state.mode === "cloze") {
    pushUndo();
    state.cards.push(normalizeCardData({
      kind: "cloze",
      q: "",
      a: "",
      choiceExcludeWords: "",
      choiceGroup: ""
    }));
    renderCards();
    setStatus("穴埋めの空行をカード一覧へ追加しました");
    return;
  }
  pushUndo();
  state.cards.push(normalizeCardData({
    kind: state.mode,
    q: "",
    a: state.mode === "vocab" ? "" : "",
    choiceExcludeWords: "",
    choiceGroup: ""
  }));
  renderCards();
  setStatus("空行を追加しました");
}

function deleteCard(index) {
  if (!state.cards[index]) return;
  if (!confirm(`${index + 1}番のカードを削除しますか？`)) return;
  pushUndo();
  state.cards.splice(index, 1);
  state.expandedRows.clear();
  renderCards();
  setStatus("カードを削除しました");
}

function duplicateCard(index) {
  if (!state.cards[index]) return;
  pushUndo();
  state.cards.splice(index + 1, 0, normalizeCardData(JSON.parse(JSON.stringify(state.cards[index]))));
  renderCards();
  setStatus("カードを複製しました");
}

function reorderCard(from, to) {
  if (from < 0 || to < 0 || from === to || !state.cards[from]) return;
  pushUndo();
  const [card] = state.cards.splice(from, 1);
  state.cards.splice(to, 0, card);
  state.expandedRows.clear();
  renderCards();
  setStatus("カードの順番を変更しました");
}

function updateCard(index, key, value) {
  const card = state.cards[index];
  if (!card) return;
  card[key] = key === "ttsAuto" ? isTruthyValue(value) : value;
  if (key === "kind" && value === "cloze") card.a = "";
  if (key === "kind" && value === "choice" && !Array.isArray(card.choices)) card.choices = ["", "", "", ""];
  if (key === "kind" && value === "choice" && !Array.isArray(card.fixedChoiceExplanations)) card.fixedChoiceExplanations = ["", "", "", ""];
  if (key === "choices" && Array.isArray(value)) card.choices = value.slice(0, 4);
  if (key === "fixedChoiceExplanations") card.fixedChoiceExplanations = normalizeChoiceExplanations(value);
}

function clearCards() {
  if (!state.cards.length) return;
  if (!confirm("作成済みカード一覧をすべて削除しますか？")) return;
  pushUndo();
  state.cards = [];
  state.expandedRows.clear();
  renderCards();
  setStatus("カード一覧をクリアしました");
}

function toggleCardDetails(index) {
  if (state.expandedRows.has(index)) {
    state.expandedRows.delete(index);
  } else {
    state.expandedRows.add(index);
  }
  renderCards();
}

function updateChoiceExplanation(index, choiceIndex, value) {
  const card = state.cards[index];
  if (!card) return;
  const explanations = normalizeChoiceExplanations(card.fixedChoiceExplanations);
  explanations[choiceIndex] = value;
  updateCard(index, "fixedChoiceExplanations", explanations);
}

function wrapSelectionAsCloze(area, number) {
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const selected = area.value.slice(start, end);
  if (!selected.trim()) {
    setStatus("カードの問題欄で穴埋めにする箇所を選択してください");
    return false;
  }
  pushUndo();
  const wrapped = `{{c${number}::${selected}}}`;
  area.value = `${area.value.slice(0, start)}${wrapped}${area.value.slice(end)}`;
  area.dispatchEvent(new Event("input", { bubbles: true }));
  area.focus();
  area.setSelectionRange(start, start + wrapped.length);
  setStatus(`選択箇所を c${number} の穴埋めにしました`);
  renderCards();
  return true;
}

function renderCards() {
  state.cards = normalizeCards(state.cards);
  el.cardsBody.innerHTML = "";
  el.cardCount.textContent = `${state.cards.length}件`;
  if (!state.cards.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 11;
    cell.className = "empty";
    cell.textContent = "まだカードがありません";
    row.appendChild(cell);
    el.cardsBody.appendChild(row);
    return;
  }

  state.cards.forEach((card, index) => {
    const row = document.createElement("tr");
    row.draggable = true;
    row.className = card.kind === "cloze" ? "kind-cloze" : card.kind === "choice" ? "kind-choice" : "kind-vocab";
    if (card.kind === "cloze" && !cardHasCloze(card)) row.classList.add("invalid");
    if (card.kind === "choice" && !cardHasValidChoices(card)) row.classList.add("invalid");
    row.addEventListener("dragstart", () => {
      state.draggedIndex = index;
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      reorderCard(state.draggedIndex, index);
    });

    row.appendChild(td(String(index + 1)));
    row.appendChild(kindCell(index, card));
    row.appendChild(textareaCell(card.q, (value) => updateCard(index, "q", value), { clozeHotkeys: card.kind === "cloze", index }));
    row.appendChild(answerCell(index, card));
    for (let choiceIndex = 0; choiceIndex < 4; choiceIndex++) {
      row.appendChild(choiceCell(index, card, choiceIndex));
    }
    row.appendChild(textareaCell(card.choiceExcludeWords || "", (value) => updateCard(index, "choiceExcludeWords", value), { small: true }));
    row.appendChild(inputCell(card.choiceGroup || "", (value) => updateCard(index, "choiceGroup", value)));
    row.appendChild(actionsCell(index));
    el.cardsBody.appendChild(row);
    if (state.expandedRows.has(index)) {
      el.cardsBody.appendChild(cardDetailsRow(index, card));
    }
  });
}

function td(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function kindCell(index, card) {
  const cell = document.createElement("td");
  const select = document.createElement("select");
  select.innerHTML = '<option value="vocab">単語帳</option><option value="cloze">穴埋め</option><option value="choice">4択</option>';
  select.value = card.kind === "cloze" ? "cloze" : card.kind === "choice" ? "choice" : "vocab";
  select.addEventListener("change", () => {
    pushUndo();
    updateCard(index, "kind", select.value);
    renderCards();
  });
  const badge = document.createElement("span");
  badge.className = "kind-badge";
  badge.textContent = select.value === "cloze" ? "穴埋め" : select.value === "choice" ? "4択" : "単語帳";
  cell.append(select, badge);
  return cell;
}

function attachUndoOnFocus(control) {
  control.addEventListener("focus", () => {
    if (!control.dataset.undoFocus) {
      pushUndo();
      control.dataset.undoFocus = "1";
    }
  });
  control.addEventListener("blur", () => {
    delete control.dataset.undoFocus;
  });
}

function textareaCell(value, onInput, options = {}) {
  const cell = document.createElement("td");
  const area = document.createElement("textarea");
  area.value = value || "";
  if (options.small) area.rows = 2;
  if (options.clozeHotkeys && el.clozeCardLock.checked) {
    area.readOnly = true;
    area.title = "穴埋め問題文ロック中です。隠したい範囲を選択して1-9を押してください。";
  }
  attachUndoOnFocus(area);
  area.addEventListener("input", () => onInput(area.value));
  if (options.clozeHotkeys) {
    area.addEventListener("keydown", (event) => {
      if (!el.clozeCardLock.checked) return;
      const digit = digitFromEvent(event);
      if (!digit || digit === "0") return;
      if (area.selectionStart === area.selectionEnd) return;
      event.preventDefault();
      wrapSelectionAsCloze(area, digit);
    });
  }
  cell.appendChild(area);
  return cell;
}

function answerCell(index, card) {
  if (card.kind !== "cloze") {
    return textareaCell(card.a || "", (value) => updateCard(index, "a", value));
  }
  const cell = document.createElement("td");
  const box = document.createElement("div");
  box.className = "auto-answer";
  box.textContent = cardHasCloze(card)
    ? "Cloze内の答えをMOZが自動抽出します"
    : "未指定: 問題文ロックONで隠す箇所を選び、1-9を押してください";
  cell.appendChild(box);
  return cell;
}

function choiceCell(index, card, choiceIndex) {
  if (card.kind !== "choice") {
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.textContent = "-";
    return cell;
  }
  const choices = Array.isArray(card.choices) ? card.choices : ["", "", "", ""];
  return textareaCell(choices[choiceIndex] || "", (value) => {
    const next = Array.isArray(card.choices) ? [...card.choices] : ["", "", "", ""];
    next[choiceIndex] = value;
    updateCard(index, "choices", next);
  }, { small: true });
}

function inputCell(value, onInput) {
  const cell = document.createElement("td");
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  attachUndoOnFocus(input);
  input.addEventListener("input", () => onInput(input.value));
  cell.appendChild(input);
  return cell;
}

function createDetailTextarea(value, onInput, options = {}) {
  const area = document.createElement("textarea");
  area.value = value || "";
  area.rows = options.rows || 2;
  if (options.placeholder) area.placeholder = options.placeholder;
  attachUndoOnFocus(area);
  area.addEventListener("input", () => onInput(area.value));
  return area;
}

function createDetailInput(value, onInput, options = {}) {
  const input = document.createElement("input");
  input.type = options.type || "text";
  input.value = value || "";
  if (options.placeholder) input.placeholder = options.placeholder;
  attachUndoOnFocus(input);
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function createDetailCheckbox(checked, onChange) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked === true;
  input.addEventListener("change", () => {
    pushUndo();
    onChange(input.checked);
  });
  return input;
}

function detailField(labelText, control, options = {}) {
  const label = document.createElement("label");
  label.className = options.wide ? "detail-field wide" : "detail-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function createDetailSection(titleText) {
  const section = document.createElement("section");
  section.className = "card-detail-section";
  const title = document.createElement("h3");
  title.textContent = titleText;
  const grid = document.createElement("div");
  grid.className = "card-detail-grid";
  section.append(title, grid);
  return { section, grid };
}

function cardDetailsRow(index, card) {
  const row = document.createElement("tr");
  row.className = "card-detail-row";
  const cell = document.createElement("td");
  cell.colSpan = 11;
  cell.className = "card-detail-cell";
  const panel = document.createElement("div");
  panel.className = "card-detail-panel";

  const tts = createDetailSection("TTS");
  tts.grid.append(
    detailField("tts_text", createDetailTextarea(card.ttsText || "", (value) => updateCard(index, "ttsText", value), {
      placeholder: "問題文とは別に読み上げたいテキスト"
    }), { wide: true }),
    detailField("tts_lang", createDetailInput(card.ttsLang || "", (value) => updateCard(index, "ttsLang", value), {
      placeholder: "例: en-US / ja-JP / zh-CN"
    })),
    detailField("tts_auto", createDetailCheckbox(card.ttsAuto === true, (checked) => updateCard(index, "ttsAuto", checked))),
    detailField("example_tts", createDetailTextarea(card.exampleTts || "", (value) => updateCard(index, "exampleTts", value), {
      placeholder: "詳細画面で再生する例文"
    }), { wide: true }),
    detailField("example_tts_lang", createDetailInput(card.exampleTtsLang || "", (value) => updateCard(index, "exampleTtsLang", value), {
      placeholder: "例: en-US"
    }))
  );
  panel.appendChild(tts.section);

  if (card.kind === "choice") {
    const explanations = normalizeChoiceExplanations(card.fixedChoiceExplanations);
    const choice = createDetailSection("4択解説");
    for (let choiceIndex = 0; choiceIndex < 4; choiceIndex++) {
      choice.grid.appendChild(detailField(
        `choice${choiceIndex + 1}_explanation`,
        createDetailTextarea(explanations[choiceIndex] || "", (value) => updateChoiceExplanation(index, choiceIndex, value), {
          placeholder: `${choiceLabel(choiceIndex)} の解説`
        })
      ));
    }
    choice.grid.append(
      detailField("explanation", createDetailTextarea(card.explanation || "", (value) => updateCard(index, "explanation", value), {
        placeholder: "問題全体の解説"
      }), { wide: true }),
      detailField("source", createDetailTextarea(card.source || "", (value) => updateCard(index, "source", value), {
        placeholder: "出典、参照元、URLなど"
      }), { wide: true })
    );
    panel.appendChild(choice.section);
  }

  cell.appendChild(panel);
  row.appendChild(cell);
  return row;
}

function actionsCell(index) {
  const cell = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "row-actions";
  const details = document.createElement("button");
  details.type = "button";
  details.textContent = state.expandedRows.has(index) ? "閉じる" : "詳細";
  details.setAttribute("aria-expanded", state.expandedRows.has(index) ? "true" : "false");
  details.addEventListener("click", () => toggleCardDetails(index));
  const duplicate = document.createElement("button");
  duplicate.type = "button";
  duplicate.textContent = "複製";
  duplicate.addEventListener("click", () => duplicateCard(index));
  const del = document.createElement("button");
  del.type = "button";
  del.className = "danger";
  del.textContent = "削除";
  del.addEventListener("click", () => deleteCard(index));
  wrap.append(details, duplicate, del);
  cell.appendChild(wrap);
  return cell;
}

function normalizeMetadata(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeTsvCell(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/\t/g, " ").trim();
}

function csvCell(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportRowValues(card) {
  return [
    card.q,
    card.a,
    card.choices[0],
    card.choices[1],
    card.choices[2],
    card.choices[3],
    card.correct,
    card.choiceExcludeWords,
    card.choiceGroup,
    card.choiceExplanations[0],
    card.choiceExplanations[1],
    card.choiceExplanations[2],
    card.choiceExplanations[3],
    card.explanation,
    card.source,
    card.ttsText,
    card.ttsLang,
    card.ttsAuto,
    card.exampleTts,
    card.exampleTtsLang
  ];
}

function validExportCards() {
  const skipped = [];
  const rows = [];
  state.cards.forEach((card, index) => {
    const normalizedCard = normalizeCardData(card);
    const kind = normalizedCard.kind;
    const q = String(normalizedCard.q || "").trim();
    const a = kind === "cloze" ? "" : String(normalizedCard.a || "").trim();
    const choices = Array.isArray(normalizedCard.choices) ? normalizedCard.choices.map(choice => String(choice || "").trim()).slice(0, 4) : [];
    while (choices.length < 4) choices.push("");
    if (!q || (kind === "vocab" && !a) || (kind === "cloze" && !cardHasCloze(normalizedCard)) || (kind === "choice" && !cardHasValidChoices(normalizedCard))) {
      skipped.push(index + 1);
      return;
    }
    const choiceExplanations = kind === "choice" ? normalizeChoiceExplanations(normalizedCard.fixedChoiceExplanations) : ["", "", "", ""];
    rows.push({
      kind,
      q,
      a,
      choices,
      correct: kind === "choice" ? a : "",
      choiceExcludeWords: normalizeMetadata(normalizedCard.choiceExcludeWords),
      choiceGroup: normalizeMetadata(normalizedCard.choiceGroup),
      choiceExplanations,
      explanation: kind === "choice" ? normalizeOptionalText(normalizedCard.explanation) : "",
      source: kind === "choice" ? normalizeOptionalText(normalizedCard.source) : "",
      ttsText: normalizeOptionalText(normalizedCard.ttsText),
      ttsLang: normalizeOptionalText(normalizedCard.ttsLang),
      ttsAuto: normalizedCard.ttsAuto ? "true" : "",
      exampleTts: normalizeOptionalText(normalizedCard.exampleTts),
      exampleTtsLang: normalizeOptionalText(normalizedCard.exampleTtsLang)
    });
  });
  return { rows, skipped };
}

function exportTsv() {
  const { rows, skipped } = validExportCards();
  if (!rows.length) {
    alert("出力できるカードがありません。単語帳は問題と解答、穴埋めはCloze指定、4択は問題・4つの選択肢・正解が必要です。");
    return;
  }
  if (skipped.length && !confirm(`未完成カード ${skipped.join(", ")} 番をスキップして出力しますか？`)) return;
  const table = [
    EXPORT_COLUMNS,
    ...rows.map(exportRowValues)
  ];
  const text = "\ufeff" + table.map((row) => row.map(sanitizeTsvCell).join("\t")).join("\n") + "\n";
  downloadBlob(new Blob([text], { type: "text/tab-separated-values;charset=utf-8" }), `moz_deck_${timestamp()}.tsv`);
  setStatus(`TSVを出力しました: ${rows.length}件`);
}

function exportCsv() {
  const { rows, skipped } = validExportCards();
  if (!rows.length) {
    alert("出力できるカードがありません。単語帳は問題と解答、穴埋めはCloze指定、4択は問題・4つの選択肢・正解が必要です。");
    return;
  }
  if (skipped.length && !confirm(`未完成カード ${skipped.join(", ")} 番をスキップして出力しますか？`)) return;
  const table = [
    EXPORT_COLUMNS,
    ...rows.map(exportRowValues)
  ];
  const text = "\ufeff" + table.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), `moz_deck_${timestamp()}.csv`);
  setStatus(`CSVを出力しました: ${rows.length}件`);
}

function collectWorkState() {
  return {
    appVersion: APP_VERSION,
    createdAt: state.createdAt,
    updatedAt: new Date().toISOString(),
    mode: state.mode,
    text1: el.text1.value,
    text2: el.text2.value,
    text1Info: el.text1Info.textContent,
    text2Info: el.text2Info.textContent,
    draftQuestion: el.draftQ.value,
    draftAnswer: el.draftA.value,
    draftExcludes: el.draftExcludes.value,
    draftGroup: el.draftGroup.value,
    clozeCardLock: el.clozeCardLock.checked,
    choiceMarkerCustom: el.choiceMarkerCustom.value,
    choiceQuestionMarker: el.choiceQuestionMarker.value,
    choiceAnswerSequence: el.choiceAnswerSequence.value,
    delimiter: el.delimiter.value,
    sourceLocked: el.sourceLock.checked,
    activePane: state.activePane,
    cards: cloneCards()
  };
}

function saveWork() {
  const json = JSON.stringify(collectWorkState(), null, 2);
  downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `moz_deck_work_${timestamp()}.mozbuild.json`);
  setStatus("作業を保存しました");
}

async function openWork(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  el.text1.value = data.text1 || "";
  el.text2.value = data.text2 || "";
  el.text1Info.textContent = data.text1Info || "復元済み";
  el.text2Info.textContent = data.text2Info || "復元済み";
  el.draftQ.value = data.draftQuestion || "";
  el.draftA.value = data.draftAnswer || "";
  el.draftExcludes.value = data.draftExcludes || "";
  el.draftGroup.value = data.draftGroup || "";
  el.clozeCardLock.checked = data.clozeCardLock !== false;
  el.choiceMarkerCustom.value = data.choiceMarkerCustom || "";
  el.choiceQuestionMarker.value = data.choiceQuestionMarker || "";
  el.choiceAnswerSequence.value = data.choiceAnswerSequence || "";
  el.delimiter.value = data.delimiter || DEFAULT_DELIMITERS;
  el.sourceLock.checked = data.sourceLocked !== false;
  state.cards = normalizeCards(data.cards);
  state.createdAt = data.createdAt || state.createdAt;
  setMode(["cloze", "choice"].includes(data.mode) ? data.mode : "vocab", { silent: true });
  setActivePane(data.activePane === "text2" ? "text2" : "text1");
  applySourceLock();
  renderCards();
  setStatus("作業を開きました");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openFind() {
  el.findbar.hidden = false;
  el.findScope.value = state.activePane;
  updateFindMatches();
  el.findInput.focus();
  el.findInput.select();
}

function closeFind() {
  el.findbar.hidden = true;
  state.findMatches = [];
  state.findIndex = -1;
  activeTextarea().focus();
}

function panesForFind() {
  const scope = el.findScope.value;
  return scope === "both" ? ["text1", "text2"] : [scope];
}

function updateFindMatches() {
  const query = el.findInput.value;
  state.findMatches = [];
  state.findIndex = -1;
  if (!query) {
    updateFindCount();
    return;
  }
  const needle = query.toLowerCase();
  for (const paneId of panesForFind()) {
    const text = (paneId === "text2" ? el.text2 : el.text1).value.toLowerCase();
    let start = 0;
    while (true) {
      const index = text.indexOf(needle, start);
      if (index < 0) break;
      state.findMatches.push({ paneId, start: index, end: index + query.length });
      start = index + Math.max(query.length, 1);
    }
  }
  moveFind(1);
}

function updateFindCount() {
  const total = state.findMatches.length;
  el.findCount.textContent = total ? `${state.findIndex + 1} / ${total}` : "0 / 0";
}

function moveFind(direction) {
  if (!state.findMatches.length) {
    updateFindCount();
    return;
  }
  state.findIndex = (state.findIndex + direction + state.findMatches.length) % state.findMatches.length;
  const match = state.findMatches[state.findIndex];
  setActivePane(match.paneId);
  const box = match.paneId === "text2" ? el.text2 : el.text1;
  box.focus();
  box.setSelectionRange(match.start, match.end);
  updateFindCount();
}

function isSourceTextarea(target) {
  return target === el.text1 || target === el.text2;
}

function isEditingTarget(target) {
  return target.closest && target.closest("td, .draft-panel, .choice-tools, .findbar");
}

function digitFromEvent(event) {
  if (/^Digit[0-9]$/.test(event.code || "")) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code || "")) return event.code.slice(6);
  if (/^[0-9]$/.test(event.key || "")) return event.key;
  return "";
}

function shortcutKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return "";
  if (/^Key[ASDZX]$/.test(event.code || "")) return event.code.slice(3);
  const key = String(event.key || "").toUpperCase();
  return ["A", "S", "D", "Z", "X"].includes(key) ? key : "";
}

function handleSourceShortcut(event, source) {
  if (state.mode === "cloze") {
    if (source === el.text1 && digitFromEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      setStatus("穴埋め箇所の指定は、作成済みカード一覧の穴埋めカード問題欄で行ってください");
      return true;
    }
  }

  const key = shortcutKey(event);
  if (!key) return false;

  if (state.mode === "choice") {
    if (!["D", "Z", "X"].includes(key)) return false;
    event.preventDefault();
    event.stopPropagation();
    setActivePane("text1");
    if (key === "D") return buildChoiceCardsFromText();
    if (key === "Z") undo();
    if (key === "X") clearDraft();
    return true;
  }

  if (state.mode === "vocab") {
    if ((key === "A" || key === "S") && !selectedTextFrom(source)) return false;
    event.preventDefault();
    event.stopPropagation();
    setActivePane(source.id);
    if (key === "A") return appendSelectionToDraft(source, "q");
    if (key === "S") return appendSelectionToDraft(source, "a");
    if (key === "D") addVocabCardFromDraft();
  } else {
    if (source === el.text1) {
      if (!["A", "D", "Z", "X"].includes(key)) return false;
      if (key === "A" && !selectedTextFrom(source)) return false;
      event.preventDefault();
      event.stopPropagation();
      setActivePane(source.id);
      if (key === "A") return addSelectionAsClozeCard(el.text1);
      if (key === "D") setStatus("穴埋めモードでは、元本文で文を選択してAを押してください");
    }
  }
  if (key === "Z") undo();
  if (key === "X") clearDraft();
  return true;
}

document.querySelectorAll("[data-load]").forEach((button) => {
  button.addEventListener("click", () => {
    state.pendingLoadPane = button.dataset.load;
    el.sourceFile.click();
  });
});

document.querySelectorAll("[data-clean]").forEach((button) => {
  button.addEventListener("click", () => cleanSources(button.dataset.clean));
});

document.querySelectorAll("[data-format]").forEach((button) => {
  button.addEventListener("click", () => formatSources(button.dataset.format));
});

document.querySelectorAll("input[name='builder-mode']").forEach((input) => {
  input.addEventListener("change", () => setMode(input.value));
});

document.querySelectorAll(".source-pane textarea").forEach((box) => {
  box.addEventListener("focus", () => setActivePane(box.id));
  box.addEventListener("keydown", (event) => handleSourceShortcut(event, box), true);
  box.addEventListener("beforeinput", (event) => {
    const data = String(event.data || "").toUpperCase();
    if (state.mode === "vocab" && (data === "A" || data === "S") && selectedTextFrom(box)) {
      event.preventDefault();
      event.stopPropagation();
      setActivePane(box.id);
      appendSelectionToDraft(box, data === "A" ? "q" : "a");
    }
  });
});

el.sourceFile.addEventListener("change", async () => {
  const file = el.sourceFile.files[0];
  el.sourceFile.value = "";
  if (file) await loadSourceFile(file, state.pendingLoadPane);
});

el.workFile.addEventListener("change", async () => {
  const file = el.workFile.files[0];
  el.workFile.value = "";
  if (file) await openWork(file);
});

document.getElementById("add-card-button").addEventListener("click", addCardFromDraft);
document.getElementById("add-empty-button").addEventListener("click", addEmptyCard);
document.getElementById("clear-draft-button").addEventListener("click", clearDraft);
document.getElementById("undo-button").addEventListener("click", undo);
document.getElementById("clear-cards-button").addEventListener("click", clearCards);
document.getElementById("save-work-button").addEventListener("click", saveWork);
document.getElementById("open-work-button").addEventListener("click", () => el.workFile.click());
document.getElementById("export-tsv-button").addEventListener("click", exportTsv);
document.getElementById("export-csv-button").addEventListener("click", exportCsv);
document.getElementById("find-close-button").addEventListener("click", closeFind);
document.getElementById("find-prev-button").addEventListener("click", () => moveFind(-1));
document.getElementById("find-next-button").addEventListener("click", () => moveFind(1));
document.getElementById("detect-delimiters-button").addEventListener("click", detectDelimiterCandidates);
document.getElementById("reset-delimiters-button").addEventListener("click", resetDelimiters);
document.getElementById("build-choice-cards-button").addEventListener("click", buildChoiceCardsFromText);
el.findInput.addEventListener("input", updateFindMatches);
el.findScope.addEventListener("change", updateFindMatches);
el.sourceLock.addEventListener("change", applySourceLock);
el.clozeCardLock.addEventListener("change", () => {
  renderCards();
  setStatus(el.clozeCardLock.checked
    ? "穴埋め問題文ロックON: 穴埋めカードの問題欄で範囲選択して1-9を押せます"
    : "穴埋め問題文ロックOFF: 問題欄を通常編集できます");
});
el.text2.addEventListener("input", updateClozeDraftGutter);
el.text2.addEventListener("scroll", syncClozeDraftGutterScroll);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openFind();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveWork();
    return;
  }
  if (!el.findbar.hidden && event.key === "Enter") {
    event.preventDefault();
    moveFind(event.shiftKey ? -1 : 1);
    return;
  }
  if (!el.findbar.hidden && event.key === "Escape") {
    event.preventDefault();
    closeFind();
    return;
  }

  if (isSourceTextarea(event.target)) {
    handleSourceShortcut(event, event.target);
    return;
  }
  if (isEditingTarget(event.target)) return;
  const key = shortcutKey(event);
  if (key === "D") {
    event.preventDefault();
    addCardFromDraft();
  } else if (key === "Z") {
    event.preventDefault();
    undo();
  } else if (key === "X") {
    event.preventDefault();
    clearDraft();
  }
});

applySourceLock();
setMode("vocab", { silent: true });
renderCards();
