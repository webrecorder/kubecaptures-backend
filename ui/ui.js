import { LitElement, html, css, styles } from 'lit-element';

import * as prettyBytes from 'pretty-bytes';
 

class EmbedProofCreator extends LitElement {
  constructor() {
    super();
    this.url = "";
    this.id = "";
    this.width = 550;
    this.done = false;
    this.working = false;
    this.statusText = "";
    this.embedCode = "";
    this.blobUrl = null;
    this.archiveSize = 0;
    this.archiveName = "";
  }

  static get properties() {
    return {
      working : Boolean,
      done: Boolean,
      url: String,
      id: String,
      width: Number,
      statusText: String,
      embedCode: String,
      archiveSize: Number,
    }
  }

  onSubmit(event) {
    event.preventDefault();
    this.startCapture();
    return false;
  }

  onNameChange(event) {
    this.archiveName = event.target.value;
    this.updateEmbedCode();
  }

  updateEmbedCode() {
    this.embedCode = `<archive-embed archiveUrl="${this.archiveName}.warc" url="http://embedserver/e/${this.url}" screenshot="true" width="${this.width}px" height="550px" autoSize></archive-embed>
<script src="sw.js"></script>
`;
  }

  async startCapture() {
    const startTime = new Date().getTime();
    
    if (!this.url) {
      return;
    }

    this.working = true;
    this.done = false;
    this.archiveSize = 0;
    this.statusText = "Starting Capture...";

    try {
      const request = new CaptureRequest("/api/capture", this.url);

      let result;

      for await (result of request) {
        this.archiveSize = result.size;
        this.statusText = result.status;
        console.log(result);
      }
      this.id = result.id;
      this.width = result.width ? result.width + 50 : 800;
      this.archiveName = result.type + "-" + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

      this.updateEmbedCode();

    } catch(e) {
      console.warn(e);
      return;

    } finally {
      this.working = false;
    }

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        "msg_type": "removeColl",
        "name": "embed",
      });
    }

    const archiveUrl = `/api/download/${this.id}/${this.archiveName}.warc`;

    const warcResp = await window.fetch(archiveUrl);

    const warcBlob = await warcResp.blob();

    this.blobUrl = URL.createObjectURL(warcBlob);

    this.done = true;

    console.log(`Elapsed: ${new Date().getTime() - startTime}`);
  }

  render() {
    return html`
      <link rel="stylesheet" href="https://unpkg.com/purecss@1.0.1/build/pure-min.css" integrity="sha384-oAOxQR6DkCoMliIh8yFnu25d7Eq/PHS21PClpwjOTeU2jRSq11vu66rf90/cZr47" crossorigin="anonymous">
      <div class="header"><h1>Archive Embed</h1></div>
      <div class="main">
      <div class="pure-u-1-1">
       <form @submit="${this.onSubmit}" class="pure-form">
        <fieldset>
        <legend>Enter a url to generate archive embed</legend>
        <input class="pure-input pure-input-1-2" type="text" id="url" name="url" .value="${this.url}" @change=${(e) => this.url = e.target.value}>
        <button class="pure-button pure-button-primary" ?disabled="${this.working}" type="submit">Archive</button>
        <div id="status-container" class="${this.working ? '' : 'hidden'}"><span class="spinner"></span>
          ${this.statusText}&nbsp;&nbsp;<i>(${prettyBytes(this.archiveSize)})</i>
        </div>
        </fieldset>
       </form>
      </div>
      ${this.done ? html`
        <div id="download-warc" class="pure-u-1-1">
          <p class="ready">Your archive is ready! Name your archive (optional) and download the archive.</p>
          <p class="indent pure-form">Change name for this archive: <input id="archive-name" class="pure-input" .value="${this.archiveName}" @input=${this.onNameChange}/></p>
          <p class="indent"><a href="${this.blobUrl}" download="${this.archiveName}.warc">Download <b>${this.archiveName}.warc</b></a>&nbsp;&nbsp;(${prettyBytes(this.archiveSize)})</p>
        </div>
        <p>Copy the following embed code to add to your site.</p>
        <div id="embedcode" class="indent">
          <textarea @click=${(e) => { e.target.focus(); e.target.select(); } } readonly>${this.embedCode}</textarea>
        </div>
        <div class="pure-u-1-1">
          <p>Embed Preview:</p>
          <div id="archive-preview" class="indent">
            <archive-embed archiveUrl="${this.blobUrl}" archiveName="${this.id}.warc" coll="embed" url="http://embedserver/e/${this.url}" screenshot="true" width="${this.width}px" height="550px" autoSize></archive-embed>
          </div>
        </div>
      ` : html``}
  `;
  }

  static get styles() {
    return css`
    .header {
      font-family: "Raleway", "Helvetica Neue", Helvetica, Arial, sans-serif;
      text-align: center;
      padding: 0em 1em;
    }
    .main {
      padding: 0em 1em;
    }
    .ready {
      font-weight: bold;
      color: darkgreen;
    }
    #archive-name {
      width: 350px;
    }
    #embedcode {
      background-color: lightgray;
      max-width: 760px;
      padding: 1.1em;
      display: block;
      margin-bottom: 1em;
      font-size: 14px;
    }
    #embedcode textarea {
      white-space: pre-line;
      width: 100%;
      min-height: 100px;
      resize: none;
      background: transparent;
      font-family: monospace;
      border: none;
      overflow: auto;
      outline: none;
      -webkit-box-shadow: none;
      -moz-box-shadow: none;
      box-shadow: none;
    }
    #status-container {
      margin: 25px;
    }
    .indent {
      margin-left: 25px;
    }
    .hidden {
      display: none;
    }
    .spinner {
      /* Spinner size and color */
      width: 1.5rem;
      height: 1.5rem;
      margin-right: 25px;
      border-top-color: #444;
      border-left-color: #444;

      /* Additional spinner styles */
      animation: spinner 400ms linear infinite;
      border-bottom-color: transparent;
      border-right-color: transparent;
      border-style: solid;
      border-width: 2px;
      border-radius: 50%;  
      box-sizing: border-box;
      display: inline-block;
      vertical-align: middle;
      animation: spinner 1s linear infinite;
    }

    /* Animation styles */
    @keyframes spinner {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    `;
  }
}


class CaptureRequest {
  constructor(wsUrl, url) {
    this.pingEvent = null;

    this._initPR();

    this.ws = new WebSocket(window.location.origin.replace('http', 'ws') + wsUrl);

    this.id = null;

    this.ws.addEventListener("open", (event) => {
      this.ws.send(url);

      this.pingEvent = setInterval(() => { this.ws.send('ping'); }, 3000);
    });


    this.ws.addEventListener("message", (event) => {
      if (event.data.startsWith("id:")) {
        this.id = event.data.slice("id:".length);
      } else if (event.data.startsWith('status')) {
        const results = JSON.parse(event.data.slice('status'.length));
        results.id = this.id;
        this.done = results.done;

        if (results.done) {
          this.close();
        }

        this._resolve(results);
        this._initPR();

      } else if (event.data === 'error') {
        this.close();
        this._reject(event.data);
      }
    });

    this.ws.addEventListener("error", (event) => {
      this.close();
    });

    this.ws.addEventListener("close", (event) => {
      this.close();
    });
  }

  _initPR() {
    this._pr = new Promise((res, rej) => {
      this._resolve = res;
      this._reject = rej;
    });
  }

  async * [Symbol.asyncIterator]() {
    while (!this.done) {
      const result = await this._pr;
      yield result;
    }
  }

  clear() {
    clearInterval(this.pingEvent);
  }

  close() {
    this.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}




customElements.define('embed-proof-creator', EmbedProofCreator);
