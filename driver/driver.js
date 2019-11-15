const express = require('express');
const fetch = require('node-fetch');
const app = express();
const querystring = require('querystring');
const fs = require('fs');

const puppeteer = require('puppeteer');
const dns = require('dns').promises;

const oembedMap = [
{
  "rx": /https?:\/\/twitter.com/,
  "oe": 'https://publish.twitter.com/oembed'
},

{
  "rx": /https?:\/\/(www\.)?instagram[.]com/,
  "oe": 'https://api.instagram.com/oembed'
},

{
  "rx": /https?:\/\/(www\.)?youtube[.]com\/watch/,
  "oe": 'http://www.youtube.com/oembed'
}
];

let done = false;

async function getOembed(url) {
  let rule = null;
  for (let r of oembedMap) {
    if (r.rx.exec(url)) {
      rule = r;
      break;
    }
  }

  if (!rule) {
    return null;
  }

  let res = await fetch(rule.oe + "?" + querystring.stringify({"url": url}));
  res = await res.json();

  console.log(res);

  return res.html;
}

const ARCHIVE_DIR = '/webarchive/collections/capture/archive/';

async function getWarcFile() {
  const files = await fs.promises.readdir(ARCHIVE_DIR);
  if (files.length) {
    return ARCHIVE_DIR + files[0];
  }
  return null;
}
 

app.get('/download', async(req, res) => {
  if (done) {
    const file = await getWarcFile();
    if (file) {
      res.sendFile(file);
      return;
    }
  }

  res.sendStatus(404);
  res.send('Not Found');
});


app.get('/done', (req, res) => {
  res.json({'done': done});
});


app.get(/.*/, async (req, res) => {
  const url = req.originalUrl.slice('/embed/'.length);
  const content = await getOembed(url);

  if (!content) {
    res.sendStatus(404);
    res.set('Content-Type', 'text/html');
    res.send('Not Found');
    return;
  }

  res.set('Content-Type', 'text/html');
  res.send(content);
});


async function runDriver() {
  const browserHost = process.env.BROWSER_HOST || 'localhost';
  const url = process.env.CAPTURE_URL;

  if (!url) {
    return;
  }

  const { address: hostname } = await dns.lookup(browserHost);

  let browser = null;

  while (!browser) {
    try {
      browser = await puppeteer.connect({'browserURL': `http://${hostname}:9222`, 'defaultViewport': null});
    } catch (e) {
      console.log('Waiting for browser...');
      await sleep(500);
    }
  }
  const pages = await browser.pages();
  const page = pages[0];

  await page.goto(url);

  sleep(1000);

  const filename = await getWarcFile();

  await waitFileDone(filename);

  done = true;

  console.log(page.url());

}

async function waitFileDone(filename) {
  while (true) {
    const { mtime } = await fs.promises.stat(filename);

    sleep(10000);

    const stats = await fs.promises.stat(filename);

    if (mtime.getTime() === stats.mtime.getTime()) {
      return true;
    }

    sleep(500);
  }
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


runDriver();

app.listen(3000)


