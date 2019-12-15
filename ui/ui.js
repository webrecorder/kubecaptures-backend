import { LitElement, html, css, styles } from 'lit-element';

import prettyBytes from 'pretty-bytes';
import JSZip from 'JSZip';
 

class EmbedProofCreator extends LitElement {
  constructor() {
    super();
    this.url = "";
    this.id = "";
    this.width = 550;
    this.height = 300;
    this.done = false;
    this.working = false;
    this.statusText = "";
    this.embedCode = "";
    this.warcBlobUrl = null;
    this.warcBlob = null;
    this.zipBlobUrl = null;
    this.zipSize = 0;
    this.archiveSize = 0;
    this.archiveName = "";
    this._request = null;
    this.error = "";
  }

  static get properties() {
    return {
      working : Boolean,
      done: Boolean,
      url: String,
      id: String,
      width: Number,
      height: Number,
      statusText: String,
      embedCode: String,
      archiveSize: Number,
      archiveName: String,
      zipSize: Number,
      error: String,
    }
  }

  onSubmit(event) {
    event.preventDefault();
    this.url = this.shadowRoot.querySelector("#url").value;
    this.startCapture();
    return false;
  }

  onCancel(event) {
    if (this._request) {
      this._request.cancel();
    }
  }

  onNameChange(event) {
    this.archiveName = event.target.value;
    this.updateEmbedCode();
  }

  onCopy(event) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.embedCode);
    }

    event.stopPropagation();
    event.preventDefault();
    return false;
  }

  updateEmbedCode() {
    this.embedCode = `<archive-embed archiveUrl="${this.archiveName}.warc" url="http://embedserver/e/${this.url}" screenshot="true" width="${this.width}px" height="${this.height}px" autoSize></archive-embed>
<script src="sw.js"></script>
`;
    this.clearZip();
  }

  async createWarcBlob() {
    const archiveUrl = `/api/download/${this.id}/${this.archiveName}.warc`;

    const warcResp = await window.fetch(archiveUrl);

    this.warcBlob = await warcResp.blob();

    if (this.warcBlobUrl) {
      URL.revokeObjectURL(this.warcBlobUrl);
    }

    this.warcBlobUrl = URL.createObjectURL(this.warcBlob);

    return this.warcBlobUrl;
  }

  clearZip() {
    if (this.zipBlobUrl) {
      URL.revokeObjectURL(this.zipBlobUrl);
      this.zipBlobUrl = null;
    }
  }

  async createZip() {
    this.clearZip();

    const zip = new JSZip();

    const wombatFetch = await window.fetch('./static/wombat.js');
    const wombatText = await wombatFetch.text();
    zip.file('static/wombat.js', wombatText, {binary: false});

    const sw = await window.fetch('./sw.js');
    const swText = await sw.text();
    zip.file('sw.js', swText, {binary: false});
    
    const example = `<!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body>
    <h1>Sample Embed</h1>
    <p>This is a sample embed from <b>${this.archiveName}</b></p>
    ${this.embedCode}
    </body>
    </html>`;

    zip.file('index.html', example, {binary: false});

    zip.file(this.archiveName + ".warc", this.warcBlob, {binary: true});

    this.zipSize = wombatText.length + example.length + swText.length + this.archiveSize;

    const zipBlob = await zip.generateAsync({type: 'blob'});

    this.zipBlobUrl =  URL.createObjectURL(zipBlob);

    return this.zipBlobUrl;
  }

  async onDownloadZip(event) {
    if (!this.zipBlobUrl) {
      this.zipBlobUrl = await this.createZip();
    }

    const a = document.createElement("a");
    a.href = this.zipBlobUrl;
    a.download = this.archiveName + "-sample.zip";
    a.click();

    event.preventDefault();

    return false;
  }

  async startCapture() {
    const startTime = new Date().getTime();

    this.working = true;
    this.done = false;
    this.archiveSize = 0;
    this.statusText = "Starting Browser...";
    this.error = "";

    try {
      this._request = new CaptureRequest("/api/capture", this.url);

      let result;

      for await (result of this._request) {
        this.archiveSize = result.size;
        this.statusText = result.status;
        console.log(result);
      }
      this.id = result.id;
      this.width = result.width ? result.width + 50 : 800;
      this.archiveName = result.type + "-" + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

      this.updateEmbedCode();

    } catch(error) {
      switch (error) {
        case "error: invalid_url":
          this.error = "Sorry, this is not a supported embed URL. Supported embeds are: Tweets, Instagram Posts, YouTube Videos";
          break;

        case "error: disconnected":
          this.error = "Connection Lost. Please Try Again";
          break;

        case "error: closed":
          this.error = "Connection Closed. Please Try Again";
          break;

        case "error: invalid_embed":
          this.error = "Sorry, this type of embed is not supported.";
          break;

        case "error: canceled":
          this.error = "Canceled";
          break;

        default:
          this.error = "Unknown Error: " + error;
      }
      this.working = false;
      return;

    }

/*    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        "msg_type": "removeColl",
        "name": "embed",
      });
    }
*/

    this.statusText = "Downloading Web Arhcive...";

    await this.createWarcBlob();

    this.statusText = "Creating ZIP...";

    await this.createZip();

    this.working = false;
    this.done = true;

    console.log(`Elapsed: ${new Date().getTime() - startTime}`);
  }

  render() {
    return html`
      <link rel="stylesheet" href="https://unpkg.com/purecss@1.0.1/build/pure-min.css" integrity="sha384-oAOxQR6DkCoMliIh8yFnu25d7Eq/PHS21PClpwjOTeU2jRSq11vu66rf90/cZr47" crossorigin="anonymous">
      <div class="header"><h1>Archive Embed</h1><h4>Supported Embeds: Tweets, Instagram Posts, YouTube Videos</h4></div>
      <div class="main">
      <div class="pure-u-1-1">
       <form @submit="${this.onSubmit}" class="pure-form">
        <fieldset>
        <legend>Enter a url to generate archive embed:</legend>
        <input class="pure-input pure-input-1-2" type="url" id="url" name="url" .value="${this.url}" @input="${(e) => this.error = ''}" required>
        <button class="pure-button pure-button-primary" ?disabled="${this.working}" type="submit">${this.working ? 'Archiving...' : 'Archive'}</button>
        <button class="pure-button ${this.working ? '' : 'hidden'}" id="cancel" type="button" @click="${this.onCancel}">Cancel</button>
        <div id="error">${this.error}</div>
        <div id="status-container" class="${this.working ? '' : 'hidden'}"><span class="spinner"></span>
          ${this.statusText}&nbsp;&nbsp;<i>(${prettyBytes(this.archiveSize)})</i>
        </div>
        </fieldset>
       </form>
      </div>
      ${this.done ? html`
        <p class="ready">Your archive is ready! You can optionally change the filename for this archive and download below.</p>
        <p class="pure-form">Archive filename: <input id="archive-name" class="pure-input" .value="${this.archiveName}" @input=${this.onNameChange}/></p>

        <details>
          <summary><a href="#" @click="${this.onDownloadZip}">Download Zip File for Hosting - ${this.archiveName}.zip</a>&nbsp;&nbsp;${this.zipSize ? "(" + prettyBytes(this.zipSize) + ")" : ""}</summary>
          <p class="indent">This download includes all the files necessary (web archive + JS files) to host this embed on your own site, including a sample <code>index.html</code> which contains the below embed code.</p>
          <p class="indent">Simply place the contents of the ZIP on a web server and load the <code>index.html</code> to see the embed.</p>
          <p class="indent">Note that the embed must be loaded from a web server, for example: <code>python -m http.server</code> or <code>node http-server</code></p>
        </details>
        <p>OR</p>
        <details>
        <summary><a href="${this.warcBlobUrl}" download="${this.archiveName}.warc">Download Web Archive Only - ${this.archiveName}.warc</a>&nbsp;&nbsp;(${prettyBytes(this.archiveSize)}) + Copy Embed Code Below...</summary>
          <ul class="instructions">
            <li>Copy the following embed code to add to your site:
            <div id="embedcode">
              <textarea @click=${(e) => { e.target.focus(); e.target.select(); } } readonly>${this.embedCode}</textarea>
              <button id="copy" @click=${this.onCopy}>Copy</button>
            </div>
            </li>
            <li>If you are hosting multiple embeds, you can add the embed code for each. The below files only need to be added once to each page.</li>
            <li><i>First time only:</i>&nbsp;&nbsp;Download <a href="/sw.js" download="sw.js">sw.js</a>. This file should be placed in same directory as the archive</li>
            <li><i>First time only:</i>&nbsp;&nbsp;Download <a href="/static/wombat.js" download="wombat.js">/static/wombat.js</a>. This file should be placed in a <code>static</code> directory</li>
          </ul>
        </details>

        <details open>
          <summary>Embed Preview:</summary>
          <p>The archived embed will render as shown below using the above embed code:</p>
          <div id="archive-preview" class="indent">
            <archive-embed archiveUrl="${this.warcBlobUrl}" archiveName="${this.id}.warc" url="http://embedserver/e/${this.url}" screenshot="true" width="${this.width}px" height="${this.height}px" autoSize></archive-embed>
          </div>
        </details>
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
    details {
      margin-top: 16px;
    }
    summary {
      display: list-item;
    }
    fieldset {
      padding-bottom: 0px;
    }
    #error {
      margin: 8px;
      color: rgb(202, 60, 60);
    }
    #embedcode {
      max-width: 760px;
      display: block;
      margin-bottom: 1em;
      font-size: 14px;
    }
    #embedcode textarea {
      background-color: ghostwhite;
      white-space: pre-line;
      width: 100%;
      min-height: 98px;
      padding: 1.1em;
      resize: none;
      font-family: monospace;
      border: 1px solid gray;
      overflow: hidden;
      box-shadow: none;
      outline: none;
    }
    #copy {
      position: relative;
      float: right;
      top: -22px;
      right: 1px;
      background: rgb(66, 184, 221);
      color: white;
      font-size: 75%;
      border-radius: 0px;
      border-width: 1px;
      outline: none;
      box-shadow: none;
      user-select: none;
      padding: 4px 8px;
    }
    #cancel {
      color: white;
      text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
      background: rgb(202, 60, 60);
    }
    #status-container {
      margin: 25px;
      font-weight: bold;
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

      } else if (event.data.startsWith('error: ')) {
        this.close();
        this._reject(event.data);
      }
    });

    this.ws.addEventListener("error", (event) => {
      this.close();
      this._reject('error: disconnected');
    });

    this.ws.addEventListener("close", (event) => {
      this.close();
      if (!this.done) {
        this._reject('error: disconnected');
      }
    });
  }

  cancel() {
    this.close();
    this.done = true;
    if (this._reject) {
      this._reject('error: canceled');
    }
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
