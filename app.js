// app.js — SecureChat client
// Attendu : env.js définit window.__ENV = { SUPABASE_URL, SUPABASE_ANON_KEY };

if(!window.__ENV){
    console.error("Env not found. Génère env.js via le build (voir README).");
  }
  
  const SUPABASE_URL = window.__ENV?.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = window.__ENV?.SUPABASE_ANON_KEY || "";
  const supabase = supabaseJs.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  // DOM
  const createBtn = document.getElementById("create-btn");
  const createPassBtn = document.getElementById("create-pass-btn");
  const titleInput = document.getElementById("title-input");
  const inviteArea = document.getElementById("invite-area");
  const inviteLinkTA = document.getElementById("invite-link");
  const copyInviteBtn = document.getElementById("copy-invite");
  const downloadInviteBtn = document.getElementById("download-invite");
  const pasteLink = document.getElementById("paste-link");
  const stateFile = document.getElementById("state-file");
  const loadBtn = document.getElementById("load-btn");
  
  const chatCard = document.getElementById("chat-card");
  const chatTitle = document.getElementById("chat-title");
  const convIdSpan = document.getElementById("conv-id");
  const messagesDiv = document.getElementById("messages");
  const nameInput = document.getElementById("name-input");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const exportStateBtn = document.getElementById("export-state");
  const copyStateBtn = document.getElementById("copy-state");
  const inviteAgainBtn = document.getElementById("invite-again");
  
  // Crypto helpers
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const randBytes = n => crypto.getRandomValues(new Uint8Array(n));
  
  async function genKey(){
    return await crypto.subtle.generateKey({name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
  }
  async function exportRawKey(key){
    return new Uint8Array(await crypto.subtle.exportKey("raw", key));
  }
  async function importRawKey(raw){
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt","decrypt"]);
  }
  async function aesEncrypt(key, plaintext){
    const iv = randBytes(12);
    const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, enc.encode(plaintext));
    return { iv: b64(iv), data: b64(new Uint8Array(ct)) };
  }
  async function aesDecrypt(key, ivB64, dataB64){
    const iv = fromB64(ivB64);
    const data = fromB64(dataB64);
    const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, data);
    return dec.decode(pt);
  }
  
  // App state
  let aesKey = null;       // CryptoKey
  let convId = null;       // id texte
  let localState = null;   // { id, title, messages: [] }
  
  // helpers UI
  function show(el){ el.classList.remove("hidden"); }
  function hide(el){ el.classList.add("hidden"); }
  
  function genId(){ return 'conv-' + Math.random().toString(36).slice(2,10); }
  function nowISO(){ return new Date().toISOString(); }
  
  // Render messages
  function renderMessages(){
    messagesDiv.innerHTML = "";
    if(!localState || !localState.messages.length){ messagesDiv.textContent="(Aucun message)"; return; }
    localState.messages.forEach(m=>{
      const div = document.createElement("div");
      div.className = "msg";
      div.innerHTML = `<div class="meta"><strong>${escapeHtml(m.sender)}</strong> • <span class="muted">${new Date(m.ts).toLocaleString()}</span></div>
                       <div class="text">${escapeHtml(m.text)}</div>`;
      messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }
  
  // Create conversation (random key)
  createBtn.addEventListener('click', async ()=>{
    const title = (titleInput.value || "Sans titre").slice(0,200);
    aesKey = await genKey();
    const raw = await exportRawKey(aesKey);
    const rawB64 = b64(raw);
    convId = genId();
    localState = { id: convId, title, messages: [] };
    inviteLinkTA.value = `${location.origin}${location.pathname}#id=${convId}&k=${encodeURIComponent(rawB64)}&pw=0`;
    show(inviteArea);
    show(chatCard);
    chatTitle.textContent = title;
    convIdSpan.textContent = convId;
    // store an encrypted "title" row so joiners can see the title (optional)
    const encTitle = await aesEncrypt(aesKey, JSON.stringify({ title }));
    await supabase.from('conversations').insert({ id: convId, type: 'title', iv: encTitle.iv, data: encTitle.data }).then(()=>{});
    subscribeRealtime();
  });
  
  // Create with password (PBKDF2) — convenience option
  createPassBtn.addEventListener('click', async ()=>{
    const title = (titleInput.value || "Sans titre").slice(0,200);
    const pwd = prompt("Choisis un mot de passe fort (ne perds pas ce mot de passe)");
    if(!pwd){ alert("Mot de passe requis"); return; }
    const salt = randBytes(16);
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(pwd), "PBKDF2", false, ["deriveKey"]);
    const derived = await crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:200000, hash:"SHA-256"}, baseKey, {name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
    aesKey = derived;
    const raw = await exportRawKey(aesKey);
    // pack salt + derived raw so invitees can reproduce (salt + derivedRaw)
    const packed = new Uint8Array([...salt, ...raw]);
    const packedB64 = b64(packed);
    convId = genId();
    localState = { id: convId, title, messages: [] };
    inviteLinkTA.value = `${location.origin}${location.pathname}#id=${convId}&k=${encodeURIComponent(packedB64)}&pw=1`;
    show(inviteArea);
    show(chatCard);
    chatTitle.textContent = title;
    convIdSpan.textContent = convId;
    const encTitle = await aesEncrypt(aesKey, JSON.stringify({ title }));
    await supabase.from('conversations').insert({ id: convId, type: 'title', iv: encTitle.iv, data: encTitle.data }).then(()=>{});
    subscribeRealtime();
  });
  
  // Copy / download invite
  copyInviteBtn.addEventListener('click', ()=>{ inviteLinkTA.select(); document.execCommand('copy'); alert('Lien copié'); });
  downloadInviteBtn.addEventListener('click', ()=>{
    const data = inviteLinkTA.value;
    const blob = new Blob([data], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${convId || 'invite'}.invite.txt`;
    a.click();
  });
  
  // Load / join
  loadBtn.addEventListener('click', async ()=>{
    // parse pasted link if present
    const text = pasteLink.value.trim();
    if(text){
      let frag = null;
      try{ frag = new URL(text).hash ? new URL(text).hash.substring(1) : null; } catch(e){
        frag = text.startsWith('#') ? text.substring(1) : text;
      }
      if(frag){
        const params = new URLSearchParams(frag);
        const id = params.get('id');
        const k = params.get('k');
        const pw = params.get('pw') === '1';
        if(!k) return alert("Lien invalide (pas de clé).");
        if(!pw){
          const raw = fromB64(decodeURIComponent(k));
          aesKey = await importRawKey(raw);
          convId = id;
          localState = { id: convId, title: "Conversation (chargement...)", messages: [] };
          show(chatCard);
          chatTitle.textContent = localState.title;
          convIdSpan.textContent = convId;
          subscribeRealtime();
          // load historical rows
          loadHistory();
          return;
        } else {
          // packed: salt(16) + derived raw (creator derived and shared full derived)
          const packed = fromB64(decodeURIComponent(k));
          const salt = packed.slice(0,16);
          const derivedRaw = packed.slice(16);
          aesKey = await importRawKey(derivedRaw);
          convId = id;
          localState = { id: convId, title: "Conversation (protégée)", messages: [] };
          show(chatCard);
          chatTitle.textContent = localState.title;
          convIdSpan.textContent = convId;
          subscribeRealtime();
          loadHistory();
          return;
        }
      }
    }
  
    // else try file import
    const f = stateFile.files[0];
    if(f){
      const content = await f.text();
      if(!aesKey) return alert("Importe/colle d'abord l'invitation (clé).");
      try{
        const state = await decryptStateFromBlob(aesKey, content.trim());
        localState = state;
        convId = state.id;
        show(chatCard);
        chatTitle.textContent = state.title;
        convIdSpan.textContent = convId;
        renderMessages();
        subscribeRealtime();
      }catch(e){
        console.error(e);
        alert("Impossible de déchiffrer l'état : clé invalide ou fichier corrompu.");
      }
      return;
    }
  
    // fallback : try read clipboard for invite or state
    try{
      const clip = await navigator.clipboard.readText();
      if(clip.includes('#id=')){
        pasteLink.value = clip;
        loadBtn.click();
        return;
      }
      if(aesKey){
        const state = await decryptStateFromBlob(aesKey, clip.trim());
        localState = state;
        convId = state.id;
        show(chatCard);
        chatTitle.textContent = state.title;
        convIdSpan.textContent = convId;
        renderMessages();
        subscribeRealtime();
        return;
      }
      alert("Aucune donnée détectée. Colle un lien ou importe un fichier d'état chiffré.");
    }catch(e){
      alert("Impossible de lire le presse-papier automatiquement. Colle manuellement.");
    }
  });
  
  // Send message
  sendBtn.addEventListener('click', async ()=>{
    if(!aesKey || !convId) return alert("Rejoins ou crée une conversation d'abord.");
    const name = (nameInput.value || "Anonyme").slice(0,80);
    const text = messageInput.value.trim();
    if(!text) return;
    const msg = { sender: name, text, ts: nowISO() };
    // push locally
    localState.messages.push(msg);
    renderMessages();
    // encrypt and push to supabase
    const encMsg = await aesEncrypt(aesKey, JSON.stringify(msg));
    await supabase.from('conversations').insert({ id: convId, type: 'message', iv: encMsg.iv, data: encMsg.data }).then(()=>{});
    messageInput.value = "";
  });
  
  // Export / copy state (optional feature)
  exportStateBtn.addEventListener('click', async ()=>{
    if(!aesKey || !localState) return alert("Rien à exporter.");
    const blobStr = await encryptStateToBlob(aesKey, localState);
    const blob = new Blob([blobStr], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${localState.id}.state.enc`;
    a.click();
  });
  copyStateBtn.addEventListener('click', async ()=>{
    if(!aesKey || !localState) return alert("Rien à copier.");
    const blobStr = await encryptStateToBlob(aesKey, localState);
    await navigator.clipboard.writeText(blobStr);
    alert("État chiffré copié dans le presse-papier.");
  });
  inviteAgainBtn.addEventListener('click', async ()=>{
    if(!aesKey || !convId) return alert("Pas de conversation");
    const raw = await exportRawKey(aesKey);
    inviteLinkTA.value = `${location.origin}${location.pathname}#id=${convId}&k=${encodeURIComponent(b64(raw))}&pw=0`;
    show(inviteArea);
  });
  
  // Utilitaires state blob
  async function encryptStateToBlob(key, state){
    const json = JSON.stringify(state);
    const encBlob = await aesEncrypt(key, json);
    return `${encBlob.iv}.${encBlob.data}`;
  }
  async function decryptStateFromBlob(key, blobStr){
    const [iv, data] = blobStr.split('.');
    if(!iv || !data) throw new Error("Format invalide");
    const json = await aesDecrypt(key, iv, data);
    return JSON.parse(json);
  }
  
  // Load history
  async function loadHistory(){
    const { data, error } = await supabase.from('conversations').select('*').eq('id', convId).order('created_at', { ascending: true });
    if(error){ console.error(error); return; }
    for(const row of data){
      await handleIncomingRow(row);
    }
  }
  
  // Realtime sub
  let channel = null;
  function subscribeRealtime(){
    if(channel) return; // déjà abonné
    channel = supabase.channel(`realtime_${convId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: `id=eq.${convId}` }, async (payload)=>{
        await handleIncomingRow(payload.new);
      })
      .subscribe();
  }
  
  // handle incoming blob row
  async function handleIncomingRow(row){
    try{
      const plain = await aesDecrypt(aesKey, row.iv, row.data);
      const obj = JSON.parse(plain);
      if(row.type === 'title'){
        chatTitle.textContent = obj.title;
        localState = localState || { id: convId, title: obj.title, messages: [] };
        localState.title = obj.title;
      } else if(row.type === 'message'){
        // push local if not duplicate (rudimentary)
        localState = localState || { id: convId, title: "Conversation", messages: [] };
        const exists = localState.messages.some(m=>m.ts === obj.ts && m.sender === obj.sender && m.text === obj.text);
        if(!exists) localState.messages.push(obj);
        renderMessages();
      }
    }catch(err){
      // Si déchiffrement échoue, ignore (clef erronée)
      console.warn("Impossible de déchiffrer une ligne (clé?)", err);
    }
  }
  
  // on load: auto-parse fragment if present
  (function parseInitial(){
    const frag = location.hash ? location.hash.substring(1) : null;
    if(!frag) return;
    const params = new URLSearchParams(frag);
    const id = params.get('id');
    const k = params.get('k');
    const pw = params.get('pw') === '1';
    if(k){
      (async ()=>{
        if(!pw){
          const raw = fromB64(decodeURIComponent(k));
          aesKey = await importRawKey(raw);
        } else {
          const packed = fromB64(decodeURIComponent(k));
          const salt = packed.slice(0,16);
          const derivedRaw = packed.slice(16);
          aesKey = await importRawKey(derivedRaw);
        }
        convId = id;
        localState = { id: convId, title: "Conversation (chargement...)", messages: [] };
        show(chatCard);
        chatTitle.textContent = localState.title;
        convIdSpan.textContent = convId;
        subscribeRealtime();
        loadHistory();
        alert("Clé importée depuis l'invitation. Chargement de l'historique...");
      })();
    }
  })();
  
  /////////////////////
  // FIN helper funcs
  /////////////////////
  