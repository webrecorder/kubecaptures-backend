import { LitElement, html, css, unsafeCSS, styles } from 'lit-element';

import prettyBytes from 'pretty-bytes';

import allCssRaw from './assets/ui.scss';

import { formatDistance } from 'date-fns';

import faDownload from '@fortawesome/fontawesome-free/svgs/solid/download.svg';
import faDelete from '@fortawesome/fontawesome-free/svgs/solid/trash-alt.svg';

import faRight from '@fortawesome/fontawesome-free/svgs/solid/angle-right.svg';
import faDown from '@fortawesome/fontawesome-free/svgs/solid/angle-down.svg';
import faRedo from '@fortawesome/fontawesome-free/svgs/solid/redo.svg';

import faCheck from '@fortawesome/fontawesome-free/svgs/solid/check-circle.svg';
import faX from '@fortawesome/fontawesome-free/svgs/solid/times-circle.svg';

const TEST_DATA = "";

// ===========================================================================
const allCss = unsafeCSS(allCssRaw);

function wrapCss(custom) {
  return [allCss, custom];
}


// ===========================================================================
class CapturesApp extends LitElement {
  constructor() {
    super();
    this.apiprefix = "";
    this.contactEmail = "";

    this.results = [];
    this.sortedResults = [];
    this.replaybase = "/replay/";

    this.extraProps = {};

    this.csrftoken = "";

    this.fieldErrorMessage = "";
    this.submittedUrlsInvalid = false;

    this.errorMessage = "";
    this.successMessage = ""

    this.archiveEmbed = false;
  }

  static get sortKeys() {
    return [
      {
        "key": "status",
        "name": "Status",
      },
      {
        "key": "userTag",
        "name": "Label"
      },
      {
        "key": "startTime",
        "name": "Start Time"
      },
      {
        "key": "duration",
        "name": "Duration"
      },
      {
        "key": "captureUrl",
        "name": "URL"
      },
      {
        "key": "size",
        "name": "Size"
      },
    ];
  }

  static get properties() {
    return {
      apiprefix: { type: String },
      contactEmail: { type: String },

      results: { type: Array },
      sortedResults: { type: Array},

      extraProps: { type: Object },

      replaybase: { type: String },

      csrftoken: { type: String },

      fieldErrorMessage: { type: String },
      submittedUrlsInvalid: { type: Boolean },

      errorMessage: { type: String },
      successMessage: { type: String },

      archiveEmbed: { type: Boolean },
    }
  }

  firstUpdated() {
    this.doUpdateResults();

    window.setInterval(() => {
      this.doUpdateResults();
    }, 5000);
  }

  async doUpdateResults() {
    if (!TEST_DATA) {
      let res = await fetch(`${this.apiprefix}/captures`);
      if (res.status == 200) {
        res = await res.json();
        this.results = res.jobs;
        this.errorMessage = "";
      } else {
        this.errorMessage = html `Sorry, the list of submitted captures is not available.${this.contactMessage()}`
      }
    } else {
      this.results = JSON.parse(TEST_DATA).jobs;
    }
  }

  updated(changedProperties) {
    if (changedProperties.has("results")) {
      const newProps = {};

      for (const result of this.results) {
        const key = result.jobid;
        newProps[key] = this.extraProps[key] || {};
        if (newProps[key].size) {
          result.size = newProps[key].size;
        }
        result.duration = new Date(result.elapsedTime) - new Date(result.startTime);
      }

      this.extraProps = newProps;
    }
  }

  static get styles() {
    return wrapCss(css`
      .result:nth-child(odd) {
        background-color: #eee;
      }

      .result:nth-child(even) {
        background-color: #ddd;
      }

      .result {
        display: flex;
        width: 100%;
      }

      .results {
        max-width: unset;
        padding: 0 2.0em;
      }

      .columns {
        margin: 0px;
      }

      .sorter {
        margin-bottom: 0.5em;
        padding-right: 2.0em;
        text-align: right;
      }

      .new-capture {
        padding: 0.5em 1.5em;
        text-align: left;
      }

      .error-wrapper {
        text-align: right;
      }

      .error {
        color: rgb(241, 70, 104);
        padding: 0.5em;
      }

      .error a {
        color: rgb(241, 70, 104);
        text-decoration: underline;
      }

      .submit-error {
        display: flex;
        justify-content: space-between;
      }
    `);
  }

  async onSubmit(event) {
    event.preventDefault();

    this.submittedUrlsInvalid = false;
    this.fieldErrorMessage = "";
    this.errorMessage = "";
    this.successMessage = "";

    const textArea = this.renderRoot.querySelector("#urls");
    const tagField = this.renderRoot.querySelector("#tag");

    const text = textArea.value;
    const tag = tagField.value;

    const rawUrls = text.trim().split("\n");
    let urls = [];

    for (let url of rawUrls) {
      url = url.trim();
      if (!url) {
        continue;
      }
      if (!/https?:\/\/[\w]+/.exec(url)) {
        this.submittedUrlsInvalid = true;
        this.fieldErrorMessage = `Invalid URL "${url}". Only URLs beginning with http:// and https:// are supported.`;

        // Send keyboard focus to the invalid field, for a11y.
        // Confirmed: focus is maintained through the component re-rendering.
        textArea.focus();
        return;
      }
      urls.push(url);
    }

    const res = await this.queueCapture(urls, tag);

    if (res.status === 201) {
      this.doUpdateResults();
      textArea.value = "";

      // Send keyboard focus to a success message, for a11y.
      const jobDetails = await res.json();
      this.successMessage = `Success: ${jobDetails.urls} submitted. JobID: ${jobDetails.jobid}`;
      await this.updateComplete;
      this.renderRoot.querySelector("#success-message").focus();

    } else {
      this.errorMessage = html `Sorry, an error occurred: capture was not started.${this.contactMessage()}`;
    }
  }

  async queueCapture(urls, tag) {
    const embeds = this.archiveEmbed;

    const opts = {
      method: "POST",
      body: JSON.stringify({urls, tag, embeds}),
      headers: {"Content-Type": "application/json"}
    };

    if (this.csrftoken) {
      opts.headers["X-CSRFToken"] = this.csrftoken;
    }

    return await fetch(`${this.apiprefix}/captures`, opts);
  }

  async onDelete(event) {
    const { jobid } = event.detail;

    if (!jobid) {
      return;
    }

    const headers = {};

    if (this.csrftoken) {
      headers["X-CSRFToken"] = this.csrftoken;
    }

    const res = await fetch(`${this.apiprefix}/capture/${jobid}`, {method: "DELETE", headers});
    if (res.status != 204) {
      this.errorMessage = html `Sorry, an error occurred: deletion failed.${this.contactMessage()}`;
    } else {
      this.doUpdateResults();
    }
  }

  contactMessage() {
    return html `${this.contactEmail ? html `<br>Please try again, or <a href="mailto:${this.contactEmail}">contact us</a> for additional assistance.` : ``}`;
  }

  onSortChanged(event) {
    this.sortedResults = event.detail.sortedData;
  }

  async onRetry(event) {
    // requeue new the same url for another capture
    const urls = [event.target.result.captureUrl];
    const tag = event.target.result.userTag;

    const res = await this.queueCapture(urls, tag);

    if (res.status === 201) {
      this.doUpdateResults();
    } else {
      this.errorMessage = html `Sorry, an error has occurred: capture not retried.${this.contactMessage()}`;
    }
  }

  render() {
    return html`
      <div class="section new-capture">
        <form @submit="${this.onSubmit}">
          ${this.csrftoken ? html`
            <input type="hidden" name="${this.csrftoken_name}" value="${this.csrftoken}"/>` : ``}
          <div class="field">
            <label for="urls" class="label">URLs</label>
            <div class="control">
              <textarea id="urls" rows="3" required class="textarea ${this.submittedUrlsInvalid ? "is-danger": ""}"
                        placeholder="Enter one or more URLs on each line"
                        aria-invalid="${this.submittedUrlsInvalid ? "true": "false"}"
                        aria-describedby="urls-errors"></textarea>
            </div>
            ${this.submittedUrlsInvalid ? html`<p id="urls-errors" class="help is-danger">${this.fieldErrorMessage}</p>` : ``}
          </div>

          <div class="field">
            <label class="checkbox">
              <input id="embed" type="checkbox" class="checkbox" @click="${(e) => this.archiveEmbed = !this.archiveEmbed}" ?value="${this.archiveEmbed}"/>
              Archive Embedded Version (if available)
            </label>
          </div>

          <div class="field">
            <label for="tag" class="label">Label (Optional)</label>
            <div class="control">
              <input id="tag" type="text" class="input" value=""/>
            </div>
          </div>

          <div class="submit-error">
            <div class="field">
              <div class="control">
                <button type="submit" class="button is-link">Capture</button>
              </div>
            </div>
            <span class="error-wrapper" aria-live="assertive">
              ${this.errorMessage ? html`
              <span class="error">${this.errorMessage}</span>
              ` : ``}
            </span>
            ${this.successMessage ? html`
            <span id="success-message" class="is-sr-only" tabindex="-1">${this.successMessage}</span>
            ` : ``}
          </div>
        </form>
      </div>
      ${this.results.length ? html`
      <h2 class="is-sr-only">Submitted Jobs</h2>
      <div class="sorter">
        <wr-sorter id="captures"
          .sortKey="startTime"
          .sortDesc="${true}"
          .sortKeys="${CapturesApp.sortKeys}"
          .data="${this.results}"
          @sort-changed="${this.onSortChanged}">
        </wr-sorter>
      </div>
      <div class="container results">
        ${this.sortedResults.map((res) => html`
        <div class="result fade-in">
          <captures-job-result
            @on-delete="${this.onDelete}"
            @on-retry="${this.onRetry}"
            .props="${this.extraProps[res.jobid]}"
            .result="${res}">
          </captures-job-result>
        </div>`)}
      </div>` : html`
      <i>No Available Captures Yet. Enter URLs above and click Capture to start capturing!</i>`}
    `;
  }
}

// ===========================================================================
class JobResult extends LitElement {
  constructor() {
    super();
    this.result = {};
    this.showPreview = false;
    this.isDeleting = false;
    this.key = null;
    this.size = -1;
  }

  static get properties() {
    return {
      key: { type: String },
      result: { type: Object },

      showPreview: { type: Boolean },

      isDeleting: { type: Boolean },

      size: { type: Number },

      props: { type: Object },
    }
  }

  updated(changedProperties) {
    if (changedProperties.has("props")) {
      this.showPreview = this.props.showPreview || false;
      this.isDeleting = this.props.isDeleting || false;
      this.size = this.props.size || -1;
      this.checkSize();

    } else {
      if (changedProperties.has("showPreview")) {
        this.props.showPreview = this.showPreview;
      }
      if (changedProperties.has("isDeleting")) {
        this.props.isDeleting = this.isDeleting;
      }
    }
  }

  fullName(){
    return `${this.result.userTag ? `Batch "${this.result.userTag }",`: '' } Capture of ${this.result.captureUrl} from ${new Date(this.result.startTime).toLocaleString()}`
  }

  async checkSize() {
    if (this.size >= 0 || this.result.status !== "Complete") {
      return;
    }

    const abort = new AbortController();
    const signal = abort.signal;

    const res = await fetch(this.result.accessUrl, {method: "GET", signal});

    if (res.status === 200) {
      this.props.size = Number(res.headers.get("Content-Length"));
      this.result.size = this.props.size;
      this.size = this.props.size;
    }

    abort.abort();
  }

  static get styles() {
    return wrapCss(css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        padding-bottom: 0.5em;
      }

      .columns {
        width: 100%;
        margin: 0px;
        max-width: unset;
      }

      replay-web-page {
        height: 500px;
        width: 100%;
        display: flex;
        border: 1px solid black;
      }

      iframe {
        height: 500px;
        width: 100%;
        display: flex;
        border: 1px solid black;
      }

      .preview {
        margin: 0 1.0em 1.0em 1.0em;
      }

      .column {
        padding: 1.0em;
        text-align: left;
      }

      .column.clip {
        text-overflow: ellipsis;
        overflow: hidden;
      }

      .column.controls {
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
      }

      @media screen and (max-width: 769px) {
        .column.controls {
          justify-content: flex-start;
        }
      }

      .column.controls.success {
        justify-content: space-around;
      }

      fa-icon {
        margin: 0 8px;
      }

      .is-loading {
        background: initial;
        border: none;
        height: 1.0em;
      }

      .in-progress {
        margin: 0 35px 0 0;
        display: inline-block;
        vertical-align: middle;
      }

      .button.is-loading::after {
        border-color: transparent transparent grey grey !important;
      }

      .checkbox {
        margin-top: 1.0em;
      }

      .minihead {
        font-size: 10px;
        font-weight: bold;
      }

      .preview-toggle {
        line-height: 1.5em;
        display: flex;
        margin-left: 0.5em;
        color: #77AE3A;
      }

      .retry {
        color: black;
      }

      .preview-toggle fa-icon {
        margin: 0px;
        margin-top: -2px;
      }

      .check {
        color: #77AE3A;
      }

      .failed {
        color: rgb(241, 70, 104);
      }

      .deleter {
        vertical-align: middle;
        color: rgb(241, 70, 104);
      }
    `);
  }

  renderStatus() {
    switch (this.result.status) {
      case "Complete":
        return html`
        <p>
          <fa-icon class="check" .svg="${faCheck}" aria-hidden="true"></fa-icon>
          <span class="is-sr-only">Complete</span>
        </p>`;

      case "In progress":
        return html`
        <p>
          <span class="is-loading button in-progress" aria-hidden="true"></span>
          <span class="is-sr-only">In Progress</span>
        </p>`;

      case "Failed":
        return html`
        <p>
          <fa-icon class="failed" .svg="${faX}" aria-hidden="true"></fa-icon>
          <span class="is-sr-only">Failed</span>
        </p>`;
    }
  }

  renderControls() {
    return html`
      ${!this.isDeleting ? html`
        <a href="#" role="button" @click="${this.onDelete}" @keyup="${this.clickOnSpacebarPress}" aria-label="Delete ${this.fullName()}" title="Delete Capture" class="deleter">
          <fa-icon .svg="${faDelete}" aria-hidden="true"></fa-icon>
        </a>` :  html`
        <span class="is-loading button" aria-hidden="true"></span>
        <span class="is-sr-only">Deletion In Progress</span>
      `}

      ${this.result.status !== "In progress" ? html`
      <a href="#" role="button" @click="${this.onRetry}" @keyup="${this.clickOnSpacebarPress}" aria-label="Retry ${this.fullName()}" title="Retry Capture" class="retry">
        <fa-icon .svg="${faRedo}" aria-hidden="true"></fa-icon>
      </a>` : ``}

      ${this.result.status === "Complete" ? html`
      <a href="${this.result.accessUrl}" class="download" aria-label="Download ${this.fullName()}" title="Download Capture">
        <fa-icon .svg="${faDownload}" aria-hidden="true"></fa-icon>
      </a>
      <a href="#" role="button" class="preview-toggle" @click="${this.onTogglePreview}" @keyup="${this.clickOnSpacebarPress}" aria-label="Preview ${this.fullName()}" aria-expanded="${this.showPreview}">
        <span class="is-hidden-tablet preview-text" aria-hidden="true">Preview</span>
        <fa-icon size="1.5em" .svg="${this.showPreview ? faDown : faRight}" aria-hidden="true"></fa-icon>
      </a>`: ``}
    `;
  }

  render() {
    const startDate = new Date(this.result.startTime);

    const tag = this.result.userTag || html `<span aria-hidden="true">-</span><span class="is-sr-only">None</span>`;

    return html`
      <div class="columns" @dblclick="${this.onTogglePreview}">
        <h3 class="is-sr-only">${this.fullName()}</h3>
        <div class="column is-1">
          <p class="minihead">Status</p>
          ${this.renderStatus()}
        </div>
        <div class="column clip is-1">
          <p class="minihead">Label</p>
          <p>${tag}</p>
        </div>
        <div class="column is-3">
          <p class="minihead">Start Time</p>
          ${startDate.toLocaleString()}
        </div>
        <div class="column is-2">
          <p class="minihead">Duration</p>
          ${formatDistance(new Date(this.result.elapsedTime), startDate, {includeSeconds: true})}
        </div>
        <div class="column clip">
          <p class="minihead">URL</p>
          <p class="url">${this.result.captureUrl}</p>
        </div>
        <div class="column is-1">
          <p class="minihead">Size</p>
          <p>${this.size >= 0 ? prettyBytes(this.size) : html`
            <span aria-hidden="true">-</span><span class="is-sr-only">0</span>`}
          </p>
        </div>
        <div class="column controls ${this.result.status === "Complete" ? "success" : ""} is-3-tablet is-2-desktop">
          ${this.renderControls()}
        </div>
      </div>
      ${this.showPreview && this.result.status === "Complete" ? html`
      <div class="preview">
        <replay-web-page
          source="${this.result.accessUrl}"
          embed="${this.result.useEmbeds ? "replayonly" : "default"}"
          url="page:0">
        </replay-web-page>
      </div>` : ``}
      `;
  }

  clickOnSpacebarPress(event) {
    // Buttons are expected to respond to both enter/return and spacebar.
    // If using `<a>` with `role='button'`, assign this handler to keyup.
    if (event.key == " ") {
      event.preventDefault();
      event.target.click();
    }
  }

  onTogglePreview(event) {
    if (!this.result.status === "Complete") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.showPreview = !this.showPreview;
  }

  onDelete(event) {
    event.preventDefault();
    const detail = this.result;
    this.isDeleting = true;
    this.dispatchEvent(new CustomEvent("on-delete", {detail}));
  }

  onRetry(event) {
    event.preventDefault();
    this.dispatchEvent(new CustomEvent("on-retry"));
  }
}

customElements.define('captures-app', CapturesApp);
customElements.define('captures-job-result', JobResult);
