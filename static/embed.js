window.addEventListener("load", () => {
  document.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    startCapture();
    return false;
  });

  let ws = null;

  async function waitForArchiveWS(url) {
    let pingEvent = null;
    if (ws) {
      ws.close();
    }
    ws = new WebSocket(window.location.origin.replace('http', 'ws') + '/api/capture');

    let id = null;

    let resolve, reject;
    const pr = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    ws.addEventListener("open", (event) => {
      ws.send(url);

      pingEvent = setInterval(() => { ws.send('ping'); }, 3000);
    });

    ws.addEventListener("message", (event) => {
      if (event.data.startsWith("id:")) {
        id = event.data.slice("id:".length);
      } else if (event.data === 'done') {
        resolve(id);
      } else if (event.data === 'error') {
        reject(event.data);
      }
    });

    ws.addEventListener("error", (event) => {
      clearInterval(pingEvent);
    });

    ws.addEventListener("close", (event) => {
      clearInterval(pingEvent);
    });

    return pr;
  }

  async function startCapture() {
    const startTime = new Date().getTime();
    
    const preview = document.querySelector("#archive-preview");

    const dlLink = document.querySelector("#download-warc");

    const url = document.querySelector("#url").value;

    if (!url) {
      return;
    }

    preview.innerHTML = "";
    dlLink.innerHTML = "";

    document.querySelector("#embedcode").classList.add("hidden");
    document.querySelector("#spinner-container").classList.remove("hidden");

    let id = null;

    try {
      id = await waitForArchiveWS(url);
    } catch(e) {
      console.warn(e);
      return;
    } finally {
      document.querySelector("#spinner-container").classList.add("hidden");
    }

    dlLink.innerHTML = `<p><a href="/api/download/${id}.warc">Download Archive</a></p>`;

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        "msg_type": "removeColl",
        "name": "embed",
      });
    }

    const embedText = `<archive-embed archive="/api/download/${id}.warc" coll="embed" url="http://embedserver/e/${url}" live="true" screenshot="true" width="800px" height="550px" autoSize></archive-embed>`;

    preview.innerHTML = embedText;

    const code = document.querySelector("code");
    code.innerText = embedText;

    document.querySelector("#embedcode").classList.remove("hidden");


    console.log(`Elapsed: ${new Date().getTime() - startTime}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

});
