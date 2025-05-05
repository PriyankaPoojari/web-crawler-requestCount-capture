const { chromium } = require('playwright');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const async = require('async');
const path = require('path');

// Load configuration
const config = require('./config.json');
let {
  MAX_CONNECTIONS,
  TIMEOUT,
  RETRY_COUNT,
  DEPTH,
  HEADLESS,
  SEARCH_CONFIG,
  CRAWLER_STATE,
  RESULT_CSV,
  AUTH,
} = config;

// Override values with Jenkins parameters (environment variables)
MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS) || MAX_CONNECTIONS;
TIMEOUT = parseInt(process.env.TIMEOUT) || TIMEOUT;
RETRY_COUNT = parseInt(process.env.RETRY_COUNT) || RETRY_COUNT;
DEPTH = parseInt(process.env.DEPTH) || DEPTH;
console.log(`MAX_CONNECTIONS: ${MAX_CONNECTIONS}, TIMEOUT: ${TIMEOUT}, RETRY_COUNT: ${RETRY_COUNT}, DEPTH: ${DEPTH}`);
// Read the ACCESS_TOKEN from the environment variable or command-line argument
// const DEFAULT_TOKEN_VALUE = process.argv.find(arg => arg.startsWith('--access_token='))?.split('=')[1] || '';
const ACCESS_TOKEN = process.env['access_token'] || '';

let restartMode = process.argv.includes('--restart');
let retryMode = process.argv.includes('--retry');
let currentVisitedUrls = new Set(); // Track currently visited URLs
let AUTH_DETAILS = {}; // DOMAIN and login type
let DOMAINS  = [];// List of domains to crawl;


// Read CSV file
async function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

async function isFileWritable(filePath) {
    try {
      // Check if file exists
      await fs.promises.access(filePath, fs.constants.F_OK);
  
      // Try opening the file and writing zero bytes (to check if locked)
      const fileHandle = await fs.promises.open(filePath, 'r+');
      try {
        await fileHandle.write('', 0); // This will fail if the file is locked (e.g., Excel)
      } catch (writeErr) {
        await fileHandle.close();
        return false; // File is likely open by another process
      }
      await fileHandle.close();
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet — check if directory is writable
        const dir = path.dirname(filePath);
        try {
          await fs.promises.access(dir, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

// Write results to CSV file
async function writeResultCSV(data, filePath) {
  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: 'domain', title: 'Domain' },
      { id: 'path', title: 'Path' },
      { id: 'html_requests', title: 'HTML request count' },
      { id: 'json_requests', title: 'JSON request count' },
      { id: 'forwarded', title: 'Forwarded' },
      { id: 'error', title: 'Error' },
    ],
  });
  await csvWriter.writeRecords(data);
  console.log(`Results written to ${filePath}`);
}

// Determine appropriate credentials based on the domain
function getAuthCredentials(authType) {
  authType = authType?.toLowerCase();
  if (authType.includes('testio')) {
    return AUTH.testio;
  }else if(authType.includes('sso')) {
    return AUTH.sso;
  }
  return AUTH.basic;
}

const browserPool = [];
// Create a pool of browsers up to MAX_CONNECTIONS
async function initializeBrowsers() {
  for (let i = 0; i < MAX_CONNECTIONS; i++) {
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext();
    browserPool.push({ browser, context, busy: false });
  }
}

// Get a free browser from the pool
async function getAvailableBrowser() {
  while (true) {
    const available = browserPool.find(b => !b.busy);
    if (available) {
      available.busy = true;
      return available;
    }
    await pause(100); // wait and retry
  }
}

// Mark browser as free
function releaseBrowser(browserObj) {
  browserObj.busy = false;
}

// Updated createAuthenticatedPage to take context
async function createAuthenticatedPage(domain, url, context) {
  const authType = AUTH_DETAILS[domain];
 // If context is not provided, create a new browser and context
  if (!context) {
    const browser = await chromium.launch({ headless: HEADLESS });
    context = await browser.newContext();
    browserPool.push({ browser, context, busy: true });
  }

  const page = await context.newPage();

  if (authType?.toLowerCase().includes('token')) {
    // Add a cookie to the context
  await context.addCookies([
    {
      name: 'access-token', 
      value: ACCESS_TOKEN, // Read the value from the environment variable
      domain: domain, 
      path: '/', // Path for the cookie
      httpOnly: false, // Set to true if the cookie is HTTP-only
      secure: true, // Set to true if the cookie is secure
    },
  ]);
  }

  await page.goto(url, {
    timeout: TIMEOUT,
    waitUntil: 'networkidle0',
  });
  await page.waitForLoadState('load');

  //SSO login page detection logic. Uncomment if SSO needed
  // const currentUrl = await page.url();
  // if (currentUrl.includes('openid-connect')) { 
  //   console.log(`SSO Login page detected for ${url}`);
  //   const auth = getAuthCredentials(authType);
  //   await performSSOLogin(page, auth, url);
  // }

  return page;
}

async function performSSOLogin(page, auth, url) {
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }), // Wait for navigation to finish
      page.click('text=Continue with EPAM'),        // Trigger the navigation
    ]);
    await page.waitForLoadState('load');

    // Fill in email and password
    await page.locator('input[type="email"]').fill(auth.username);
    await page.locator('input[type="submit"]').click();
    await page.waitForLoadState('load');
    await page.locator('input[type="password"]').fill(auth.password);
    await page.locator('input[type="submit"]').click();
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000); // Wait for 3 seconds after login

    const currentURL = await page.url();
    if (currentURL.includes(new URL(url).hostname)) {
      console.log(`SSO Login successful for ${url}.`);
    } else {
      console.log(`SSO Login Failed for ${url}.`);
      throw new Error('SSO Login Failed');
    }
  } catch (err) {
    console.error(`Error during SSO login: ${err.message}`);
    throw err;
  }
}

function pause(waitTime) {
  return new Promise((resolve) => setTimeout(resolve, waitTime));
}

function getErrorMessage(err) {
  if (err.message.includes('Timeout')) {
    return 'timeout';
  }
  if (err.message.includes("reading 'includes'")) {
    return 'invalid domain URL';
  }
  if(err.message.includes("reading 'status'")){
    return 'navigation to url failed'
  }
  return err.message;
}

// Removes non-ASCII characters and trims whitespace that could be non-intentionally copied to search-config CSV file
function cleanCSVData(domain) {
  return domain.replace(/[^\x20-\x7E]/g, '').trim(); 
}

/**
 * Main crawl function
 * Iterates through URLs and loads them using loadPageWithRetries.
 * Collects result metrics for each URL.
 */
async function crawl(searchConfig) {
    const results = [];
  
    const queue = async.queue(async (config) => {
      let urlPath = cleanCSVData(config.Domain) + cleanCSVData(config.Path).replace(/\/+$/, '');
      const url = `https://${urlPath}/`;
  
      const browserObj = await getAvailableBrowser();
      const context = browserObj.context;
  
      let page;
      try {
        page = await createAuthenticatedPage(config.Domain, url, context);
        const localResults = [];
        await crawlPage(config, page, url, 0, localResults);
        results.push(...localResults);
      } catch (err) {
        console.error(`Failed to crawl ${url}: ${err.message}`);
        results.push({
          domain: new URL(url).hostname,
          path: new URL(url).pathname + new URL(url).search,
          html_requests: -1,
          json_requests: -1,
          forwarded: false,
          error: getErrorMessage(err),
        });
      }
  
      if (page) await page.close();
      releaseBrowser(browserObj);
    }, MAX_CONNECTIONS);
  
    searchConfig.forEach((config) => queue.push(config));
    await queue.drain();
    return results;
  }
  
// Crawl a page and its links recursively
// Collect metrics for HTML and JSON requests, forwarded status, and errors 
async function crawlPage(config, page, url, depth, results) {
    let html_requests = -1; // default value
    let json_requests = -1; // default value
    let forwarded = false;
    let error = '';
    let response;
  
    try {
      console.log(`Crawling ${url} at depth ${depth}`);
       // Attach response listener only if the main page loads successfully
      // Remove any existing listeners to avoid duplicate event handling
        page.removeAllListeners('response');
        page.on('response', async (response) => {
          const responseStatus = response.status();
          const request = response.request();
          const method = request.method();
          if (method === 'GET' && responseStatus < 400) { //filtering only GET method and response status other than 400 or 500
                try {
                const contentType = response.headers()['content-type'];
                if (contentType) {
                    if (contentType.includes('text/html')) {
                    html_requests++;
                    } else if (contentType.includes('application/json')) {
                    json_requests++;
                    }
                }
                } catch (err) {
                console.error(`Error processing response: ${err.message}`);
                }
          }
        });
          
      for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
          json_requests = 0;
          html_requests = 0;
          currentVisitedUrls.add(url);
      
          response = await page.goto(url, {
            timeout: TIMEOUT * attempt,
            waitUntil: 'networkidle0',
          });
          await page.waitForLoadState('load');
          await page.waitForLoadState('networkidle');
         
          const status = response.status();
          if (status === 200) break;
          else if (status === 429) { // Too Many Requests
            // Implement backoff for 429 status
            const waitTime = 1000 * attempt;
            console.warn(`429 Too Many Requests for ${url}. Waiting ${waitTime}ms before retrying...`);
            await pause(waitTime);
            // await new Promise((res) => setTimeout(res, waitTime));
          } else if (status === 500 || status === 502) {
            console.warn(`Main page load failed for ${url} with status ${status}. Retrying (${attempt}/${RETRY_COUNT})...`);
          }
        } catch (err) {
          console.error(`Error on attempt ${attempt} for ${url}: ${err.message}`);
          if (err.message.includes('browser has been closed')) {
            try {
              await page.close();
              await browser.close();
            } catch (_) {}
            page = await createAuthenticatedPage(config.Domain,url);
          }
        }
      }
  
      const status = response.status();
      const contentType = response.headers()['content-type'];
      console.log(`Loaded ${url} with content type ${contentType} and status ${status}`);
  
      // Check for HTTP errors
      if (status >= 400) {
        error = status;
      }
  
      // Check for redirects
      if (status >= 300 && status < 400) {
        forwarded = true;
        const forwardUrl = response.headers()['location'];
        if (forwardUrl) {
          await crawlPage(config,page, forwardUrl, depth, results);
        }
      }
       
      // Record the result for the current page
      if(error !== '') { //Additional check for unexpected error
        html_requests = -1;
        json_requests = -1;
      }
      results.push({
        domain: new URL(url).hostname,
        path: new URL(url).pathname + new URL(url).search, //new URL(url),
        html_requests,
        json_requests,
        forwarded,
        error,
      });
    
      //-1 have to run indefinitely till no more links found on the page
      // 0 means only crawl the main page and not the links
      // > 0 means crawl the main page and its links up to the specified depth
      // not crawling for RESTART Mode and RETRY Mode as all visited urls are already in the state file
      // Determine whether to crawl links
        const shouldCrawlLinks = ((DEPTH === -1) || (DEPTH > 0 && depth < DEPTH)) && !restartMode && !retryMode;
        if (shouldCrawlLinks) {
            const links = await page.$$eval('a', (anchors) => {
                const hrefs = anchors
                  .map((a) => a.href)
                  .filter((href) => href.trim() !== '' && !href.includes('#')); // exclude empty and hash links
                return Array.from(new Set(hrefs));
              });
            // console.log("Links for url:" + url + " are: " + links);
            for (const link of links) {
                const urlObj = new URL(link);
                const fileExtensions = [".pdf", ".zip", ".jpg", ".png", ".jpeg"];
                const isFile = fileExtensions.some((ext) => urlObj.pathname.includes(ext));
                const shouldCallCrawl = DOMAINS.includes(urlObj.hostname) && !currentVisitedUrls.has(link) && !isFile
                if (shouldCallCrawl) {
                    page = await crawlPage(config, page, link, depth + 1, results);
                }
            }
        }
      

    } catch (err) {
      console.error(`Error crawling ${url}: ${err.message}`);
      results.push({
        domain: new URL(url).hostname, //config.domain,
        path: new URL(url).pathname + new URL(url).search,
        html_requests: -1,
        json_requests: -1,
        forwarded: false,
        error: getErrorMessage(err),
      });
    }
    return page;
}

(async () => {
  const searchConfig = await readCSV(SEARCH_CONFIG);
  // Map Domain as key and Login as value
  AUTH_DETAILS = searchConfig.reduce((acc, config) => {
  acc[cleanCSVData(config.Domain)] = cleanCSVData(config.Login); 
  return acc;
}, {});

  DOMAINS = searchConfig.map(config => cleanCSVData(config.Domain)); 

  // const browser = await chromium.launch({ headless: HEADLESS });
  let results = [];
  await initializeBrowsers();

  // Check if result CSV is accessible before proceeding
  const isResultCsvAccessible = await isFileWritable(RESULT_CSV);
  const isCrawlerStateCsvAccessible = await isFileWritable(CRAWLER_STATE);
  if (!isResultCsvAccessible || !isCrawlerStateCsvAccessible) {
    console.error('Exiting due to inaccessible result CSV file.');
    // await browser.close();
    process.exit(1);
  }

  // Archive the crawler_state.csv file before restarting
    if (restartMode) { 
    const date = new Date().toISOString().replace(/:/g, '-').slice(0, 19).replace('T', '_');
    const archiveFolder = 'crawlerState-archive';
    const archivedFilePath = `${archiveFolder}/crawler_state_${date}.csv`;
  
    try {
      // Ensure the folder exists
      await fs.promises.mkdir(archiveFolder, { recursive: true });
  
      // Copy the file to the archive folder
      await fs.promises.copyFile(CRAWLER_STATE, archivedFilePath);
      console.log(`File copied to archive: ${archivedFilePath}`);
    } catch (err) {
      console.error(`Error archiving file: ${err.message}`);
      process.exit(1); // Exit if the file operation fails
    }
  }

  if (restartMode) {
    console.log("Restarting crawling for visited links from crawler_state.csv");
    const crawlerState = await readCSV(CRAWLER_STATE);
    // results = await crawl(browser, crawlerState);
    results = await crawl(crawlerState);
  } else if (retryMode) {
    console.log("Retrying crawling for failed links from crawler_state.csv");
    const crawlerState = await readCSV(CRAWLER_STATE);
    
    // Filter out URLs that have already been successfully visited
    const errConfig = [];
    // Iterate through each row in crawlerState
    for (const row of crawlerState) {
      if (row["HTML request count"] !== '-1' && row["JSON request count"] !== '-1') {
        const rowData = {
          domain: row.Domain,
          path: row.Path,
          html_requests: row["HTML request count"],
          json_requests: row["JSON request count"],
          forwarded: row.Forwarded,
          error: row.Error,
        };
        results.push(rowData); // Add to results if no errors
      } else {
        errConfig.push(row); // Add to errConfig if errors exist
      }
    }
    if(errConfig.length > 0){
      console.log(`Retrying ${errConfig.length} failed links...`);
    
      // Retry crawling for failed links
      const retryResults = await crawl(errConfig);
      results.push(...retryResults);
    }else{
      console.log(`0 failed links.Skipping retrying.`);
    }
  }else { // Normal crawling mode
    results = await crawl(searchConfig);
  }

  await writeResultCSV(results, RESULT_CSV);
  await writeResultCSV(results, CRAWLER_STATE); //same results data in state
  console.log("Crawling completed. Results saved!!!");
  for (const browserObj of browserPool) {
    try{
    await browserObj?.context?.close();
    await browserObj?.browser?.close();
    }catch(err) {
    //error while closing browser
    }
  }

  process.exit(0);
  // await browser.close();
})();
