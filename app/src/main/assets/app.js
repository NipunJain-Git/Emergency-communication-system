const ALERTS = {
  rescue: { title:"Rescue", text:"🚨 EMERGENCY: Rescue assistance required. Please respond immediately." },
  enemy: { title:"Enemy Activity", text:"⚠️ ALERT: Enemy activity reported at current location." },
  medical: { title:"Medical Emergency", text:"🏥 MEDICAL EMERGENCY: Immediate medical assistance required." },
  disaster: { title:"Natural Disaster", text:"🌪️ ALERT: Natural disaster reported. Assistance required." }
};

const defaults = {
  role:"sender",
  screen:"chat",
  demo:false,
  espConnected:false,
  espState:"disconnected",
  messages:[
    {from:"sender", text:"Need medical assistance at Checkpoint 3", time:"10:31 AM", status:"Delivered via LoRa"},
    {from:"receiver", text:"Message Delivered", time:"10:32 AM", status:"Via LoRa"},
    {from:"sender", text:"Enemy movement observed near Border Post", time:"10:33 AM", status:"Delivered via LoRa"},
    {from:"receiver", text:"Rescue team dispatched", time:"10:33 AM", status:"Via LoRa"},
    {from:"receiver", text:"Stay at current location", time:"10:34 AM", status:"Via LoRa"}
  ]
};

let state;
try { state = {...defaults, ...JSON.parse(localStorage.getItem("ec-android-state") || "{}")}; }
catch { state = {...defaults, messages:[...defaults.messages]}; }

const save = () => localStorage.setItem("ec-android-state", JSON.stringify(state));
const esc = s => String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const now = () => new Intl.DateTimeFormat([], {hour:"numeric", minute:"2-digit"}).format(new Date());
const roleName = () => state.role === "sender" ? "Sender" : "Receiver";

function toast(msg, type=""){
  const el=document.createElement("div");
  el.className=`toast ${type}`;
  el.textContent=msg;
  document.querySelector("#toastRoot").appendChild(el);
  setTimeout(()=>el.remove(),3000);
}

function setHardwareState(mode, text){
  const pill=document.querySelector("#connectionPill");
  const txt=document.querySelector("#connectionText");
  const dot=document.querySelector("#connectionDot");
  const hs=document.querySelector(".hardware-state");
  const ht=document.querySelector("#hardwareStateText");
  if(!pill||!txt||!dot) return;
  pill.classList.remove("disconnected","connecting","connected","error");
  pill.classList.add(mode);
  txt.textContent=text;
  if(hs){
    hs.classList.remove("active","tx","rx","error");
    if(mode==="connected") hs.classList.add("active");
    if(mode==="connecting") hs.classList.add("tx");
    if(mode==="error") hs.classList.add("error");
  }
  if(ht) ht.textContent = text;
}

function nativeAvailable(){
  return typeof AndroidBLE !== "undefined";
}

function connectESP32(){
  if(!nativeAvailable()){
    toast("Open this app as the Android APK to use ESP32 Bluetooth.","error");
    return;
  }
  setHardwareState("connecting", "Connecting…");
  document.querySelector("#connectBtn").textContent="Connecting…";
  try{
    AndroidBLE.connect(state.role);
  }catch(e){
    setHardwareState("error","Connection error");
    document.querySelector("#connectBtn").textContent="Connect ESP32";
    toast("Could not start Bluetooth connection.","error");
  }
}

function disconnectESP32(){
  if(!nativeAvailable()) return;
  try{ AndroidBLE.disconnect(); }catch{}
  state.espConnected=false; save();
  setHardwareState("disconnected","ESP32 Disconnected");
  document.querySelector("#connectBtn").textContent="Connect ESP32";
}

window.onEsp32State = function(status, detail){
  state.espState=status;
  state.espConnected=status==="connected";
  save();

  const btn=document.querySelector("#connectBtn");
  if(status==="connected"){
    setHardwareState("connected", `ESP32 Connected`);
    if(btn) btn.textContent="Disconnect";
    toast(`Connected to Emergency-${state.role==="sender"?"Sender":"Receiver"}.`,"success");
    return;
  }
  if(status==="connecting"){
    setHardwareState("connecting","Connecting…");
    if(btn) btn.textContent="Connecting…";
    return;
  }
  if(status==="disconnected"){
    setHardwareState("disconnected","ESP32 Disconnected");
    if(btn) btn.textContent="Connect ESP32";
    return;
  }
  if(status==="error"){
    setHardwareState("error", detail || "Bluetooth error");
    if(btn) btn.textContent="Connect ESP32";
    toast(detail || "ESP32 connection failed.","error");
    return;
  }
  if(status==="tx"){
    const hs=document.querySelector(".hardware-state");
    if(hs){hs.classList.remove("active","rx","error");hs.classList.add("tx");}
    if(document.querySelector("#hardwareStateText")) document.querySelector("#hardwareStateText").textContent="LoRa transmitting…";
    return;
  }
  if(status==="rx"){
    const hs=document.querySelector(".hardware-state");
    if(hs){hs.classList.remove("active","tx","error");hs.classList.add("rx");}
    if(document.querySelector("#hardwareStateText")) document.querySelector("#hardwareStateText").textContent="LoRa message received";
    setTimeout(()=>{ if(state.espConnected) setHardwareState("connected","ESP32 Connected"); },900);
    return;
  }
}

window.onEsp32Message = function(raw){
  if(typeof raw!=="string") return;
  if(raw.startsWith("ACK|")){
    const id=raw.substring(4).trim();
    const m=state.messages.find(x=>x.id===id);
    if(m){m.pending=false;m.status="Delivered via LoRa";save();renderMessages();}
    else toast(`LoRa ACK received: ${id}`,"success");
    setHardwareState("rx","LoRa ACK received");
    setTimeout(()=>{ if(state.espConnected) setHardwareState("connected","ESP32 Connected"); },900);
    return;
  }

  if(raw.startsWith("STATUS|TX_OK|")){
    const id=raw.substring("STATUS|TX_OK|".length).trim();
    const m=state.messages.find(x=>x.id===id);
    if(m){m.pending=true;m.status="Sent to LoRa";save();renderMessages();}
    setHardwareState("tx","LoRa transmitting…");
    return;
  }

  if(raw.startsWith("STATUS|TX_FAILED|")){
    const id=raw.substring("STATUS|TX_FAILED|".length).trim();
    const m=state.messages.find(x=>x.id===id);
    if(m){m.pending=false;m.status="Failed";save();renderMessages();}
    setHardwareState("error","LoRa transmission failed");
    toast("LoRa transmission failed.","error");
    return;
  }

  if(raw.startsWith("MSG|RECEIVED|")){
    const parts=raw.split("|");
    const id=parts[2]||"";
    const text=parts.slice(3).join("|").replace(/\|RSSI=.*$/,"");
    if(!state.messages.some(m=>m.id===id)){
      state.messages.push({from:state.role==="sender"?"receiver":"sender", text, time:now(), status:"Via LoRa", id, alert:/^(🚨|⚠️|🏥|🌪️)/.test(text)});
      save();renderMessages();
      toast("New message received via LoRa.","success");
    }
    setHardwareState("rx","LoRa message received");
    setTimeout(()=>{ if(state.espConnected) setHardwareState("connected","ESP32 Connected"); },900);
  }
}

function render(){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.querySelector(`#${state.screen}View`).classList.add("active");
  document.querySelectorAll("[data-screen]").forEach(b=>b.classList.toggle("active",b.dataset.screen===state.screen));
  document.querySelectorAll("[data-role]").forEach(b=>b.classList.toggle("active",b.dataset.role===state.role));

  document.querySelector("#roleEyebrow").textContent=`${roleName().toUpperCase()} MODE`;
  document.querySelector("#chatSubheading").textContent=state.role==="sender"
    ?"Send a message or choose an emergency alert."
    :"Reply, share a suggestion, or send an update to the sender.";
  document.querySelector("#messageInput").placeholder=state.role==="sender"
    ?"Type a message…":"Reply or add a suggestion…";
  document.querySelector("#replyHint").innerHTML = state.role==="receiver"
    ? "<span>You can reply or send a suggestion back to the sender.</span>"
    : "<span>The receiver can reply or add a suggestion at any time.</span>";
  document.querySelector("#deviceId").textContent=`EC-${state.role.toUpperCase()}-01`;
  document.querySelector("#demoToggle").classList.toggle("on",state.demo);
  renderMessages();
  if(state.espConnected) setHardwareState("connected","ESP32 Connected");
  else setHardwareState("disconnected","ESP32 Disconnected");
  const btn=document.querySelector("#connectBtn");
  if(btn) btn.textContent=state.espConnected?"Disconnect":"Connect ESP32";
  save();
}

function renderMessages(){
  const box=document.querySelector("#messages");
  box.innerHTML = [
    `<div class="date-divider"><span>Today</span></div>`,
    ...state.messages.map(m=>{
      const mine=m.from===state.role;
      const direction=mine?"out":"in";
      const label=mine?"You":(m.from==="sender"?"Sender":"Receiver");
      return `<div class="message-row ${direction}">
        ${!mine?`<div class="msg-avatar" aria-hidden="true">${m.from==="sender"?"S":"R"}</div>`:""}
        <div class="message ${direction} ${m.alert?"alert":""} ${m.pending?"pending":""}">
          <div class="message-author">${esc(label)}</div>
          <p>${esc(m.text)}</p>
          <div class="message-meta">
            ${m.status?.includes("LoRa")?'<span class="lora-badge">📡 LoRa</span>':""}
            <span>${esc(m.time)}</span><span>${esc(m.status||"")}</span>
          </div>
        </div>
      </div>`;
    })
  ].join("");
  box.scrollTop=box.scrollHeight;
}

function sendMessage(){
  const input=document.querySelector("#messageInput");
  const text=input.value.trim();
  if(!text){toast("Type a message first.","error");input.focus();return;}
  if(text.length>120){toast("Keep messages under 120 characters for reliable radio transmission.","error");return;}

  const id=`${state.role==="sender"?"S":"R"}-${Date.now()}`;
  const message={from:state.role,text,time:now(),status:"Sending…",pending:true,id};
  state.messages.push(message);
  input.value="";
  render();

  if(nativeAvailable() && state.espConnected && !state.demo){
    try{
      AndroidBLE.sendMessage(text,id);
      setHardwareState("tx","Sending to ESP32…");
      toast("Message sent to ESP32.");
    }catch(e){
      message.pending=false;message.status="Failed";
      save();renderMessages();setHardwareState("error","ESP32 send failed");
      toast("Could not send to ESP32.","error");
    }
    return;
  }

  // Fallback only if demo mode is deliberately enabled.
  if(state.demo){
    toast("Demo message sent.");
    setTimeout(()=>{
      message.pending=false;message.status="Delivered via LoRa";
      state.messages.push({from:state.role==="sender"?"receiver":"sender",text:"Message Delivered",time:now(),status:"Via LoRa",id:`demo-${Date.now()}`});
      save();render();
    },1000);
  }else{
    message.pending=false;message.status="ESP32 not connected";
    save();renderMessages();
    toast("Connect the ESP32 before sending.","error");
  }
}

function chooseAlert(key){
  const alert=ALERTS[key];
  document.querySelector("#modalRoot").innerHTML=`
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="alertTitle">
      <div class="modal">
        <h3 id="alertTitle">${alert.title} Alert</h3>
        <p>This sends an emergency message from the current user through Bluetooth → ESP32 → LoRa.</p>
        <div class="modal-preview">${esc(alert.text)}</div>
        <div class="modal-actions"><button class="modal-cancel" id="cancelAlert">Cancel</button><button class="modal-send" id="confirmAlert">Send Alert</button></div>
      </div>
    </div>`;
  document.querySelector("#cancelAlert").onclick=()=>document.querySelector("#modalRoot").innerHTML="";
  document.querySelector("#confirmAlert").onclick=()=>{
    document.querySelector("#modalRoot").innerHTML="";
    const input=document.querySelector("#messageInput"); input.value=alert.text; sendMessage();
  };
}

document.querySelector("#connectBtn").onclick=()=>state.espConnected?disconnectESP32():connectESP32();
document.querySelector("#sendBtn").onclick=sendMessage;
document.querySelector("#messageInput").addEventListener("keydown",e=>{if(e.key==="Enter")sendMessage();});
document.querySelector("#attachBtn").onclick=()=>toast("Attachments are intentionally kept out of this demo.");
document.querySelectorAll("[data-alert]").forEach(btn=>btn.onclick=()=>chooseAlert(btn.dataset.alert));
document.querySelector("#demoToggle").onclick=()=>{
  state.demo=!state.demo;save();render();
  toast(`Demo mode ${state.demo?"enabled":"disabled"}.`);
};

document.addEventListener("visibilitychange",()=>{ if(!document.hidden && state.espConnected) setHardwareState("connected","ESP32 Connected"); });

bindRoles();
bindNavigation();
render();

function bindRoles(){
  document.querySelectorAll("[data-role]").forEach(btn=>{
    btn.onclick=()=>{
      if(state.espConnected && nativeAvailable()){ disconnectESP32(); }
      state.role=btn.dataset.role;
      state.screen="chat";
      state.espConnected=false;
      state.espState="disconnected";
      save(); render();
      toast(`Switched to ${roleName().toLowerCase()} mode.`);
    };
  });
}
function bindNavigation(){
  document.querySelectorAll("[data-screen]").forEach(btn=>{
    btn.onclick=()=>{state.screen=btn.dataset.screen;save();render();};
  });
}
