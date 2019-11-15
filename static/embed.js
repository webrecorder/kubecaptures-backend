window.addEventListener("load", () => {
  document.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    startCapture();
    return false;
  });

  async function startCapture() {
    const url = document.querySelector("#url").value;

    document.querySelector("#spinner-container").classList.remove("hidden");

    const resp = await window.fetch("/api/capture/" + url);
    const data = await resp.json();

    console.log(data);

    const id = data.id;

    await waitForArchive(id);

    document.querySelector("#spinner-container").classList.add("hidden");

    const result = document.querySelector("#archive-result");
    result.innerHTML = `<template data-archive-file="/api/download/${id}.warc" data-archive-name="embed" data-url="http://embedserver:3000/embed/${url}" data-width="800px" data-height="550px">Test</template>`;

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        "msg_type": "removeColl",
        "name": "embed",
      });
    }

    initTemplates(false);
  }

  async function waitForArchive(id) {
    let resolve, reject;
    const pr = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    try {
      while (true) {
        const res = await window.fetch("/api/done/" + id);
        const json = await res.json();
        if (json.done) {
          resolve(json.done);
          break;
        }
        await sleep(1000);
      }
    } catch (e) {
      reject(e);
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

});
