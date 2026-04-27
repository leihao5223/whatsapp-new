const STORAGE_KEY = "whatsapp-new-state-v1";

const initialState = {
  activeChatId: "c1",
  contacts: [
    {
      id: "c1",
      name: "Alex",
      status: "在线",
      messages: [
        { id: "m1", fromMe: false, text: "早上好，今天的 demo 准备好了吗？", time: "08:42" },
        { id: "m2", fromMe: true, text: "差不多了，我再补一点样式。", time: "08:45" }
      ]
    },
    {
      id: "c2",
      name: "产品群",
      status: "5 位成员",
      messages: [
        { id: "m3", fromMe: false, text: "记得把 README 里的启动步骤写清楚。", time: "09:10" }
      ]
    },
    {
      id: "c3",
      name: "Mia",
      status: "离线",
      messages: [
        { id: "m4", fromMe: false, text: "晚点我们过一下交互细节。", time: "昨天" }
      ]
    }
  ]
};

const state = loadState();

const elements = {
  contactSearch: document.getElementById("contactSearch"),
  contactList: document.getElementById("contactList"),
  chatTitle: document.getElementById("chatTitle"),
  chatSubtitle: document.getElementById("chatSubtitle"),
  messageList: document.getElementById("messageList"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("messageInput")
};

elements.contactSearch.addEventListener("input", renderContacts);
elements.contactList.addEventListener("click", onSelectContact);
elements.composer.addEventListener("submit", onSendMessage);

render();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(initialState);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.contacts) || parsed.contacts.length === 0) {
      return structuredClone(initialState);
    }
    return parsed;
  } catch {
    return structuredClone(initialState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  renderContacts();
  renderActiveChat();
}

function renderContacts() {
  const query = elements.contactSearch.value.trim().toLowerCase();
  const filteredContacts = state.contacts.filter((contact) =>
    contact.name.toLowerCase().includes(query)
  );

  elements.contactList.innerHTML = "";

  filteredContacts.forEach((contact) => {
    const li = document.createElement("li");
    li.dataset.contactId = contact.id;
    li.className = `contact-item ${contact.id === state.activeChatId ? "active" : ""}`;

    const lastMessage = contact.messages[contact.messages.length - 1];
    li.innerHTML = `
      <div class="contact-name">${escapeHTML(contact.name)}</div>
      <div class="contact-preview">${escapeHTML(lastMessage ? lastMessage.text : "暂无消息")}</div>
    `;
    elements.contactList.appendChild(li);
  });
}

function renderActiveChat() {
  const chat = getActiveChat();
  if (!chat) {
    elements.chatTitle.textContent = "选择一个会话";
    elements.chatSubtitle.textContent = "准备开始聊天";
    elements.messageList.innerHTML = "";
    return;
  }

  elements.chatTitle.textContent = chat.name;
  elements.chatSubtitle.textContent = chat.status;
  elements.messageList.innerHTML = "";

  chat.messages.forEach((message) => {
    const article = document.createElement("article");
    article.className = `bubble ${message.fromMe ? "me" : "them"}`;
    article.innerHTML = `
      <p>${escapeHTML(message.text)}</p>
      <time>${escapeHTML(message.time)}</time>
    `;
    elements.messageList.appendChild(article);
  });

  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function onSelectContact(event) {
  const target = event.target.closest("[data-contact-id]");
  if (!target) return;
  state.activeChatId = target.dataset.contactId;
  saveState();
  render();
}

function onSendMessage(event) {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text) return;

  const chat = getActiveChat();
  if (!chat) return;

  chat.messages.push({
    id: `m${Date.now()}`,
    fromMe: true,
    text,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  });

  elements.messageInput.value = "";
  saveState();
  render();
}

function getActiveChat() {
  return state.contacts.find((contact) => contact.id === state.activeChatId);
}

function escapeHTML(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
