# Web Crawler Utility

This utility is a web crawler built using Playwright and Node.js. It is designed to crawl web pages, collect metrics such as HTML and JSON request counts, and handle retries for failed links. The results are saved in CSV files for further analysis.

The HTML and JSON request count is only of GET APIs with status < 400 (200s, 300s)

# Features

Crawl Web Pages: Iterates through URLs and collects metrics like HTML and JSON request counts.  
Authentication: Supports HTTP and SSO authentication for specific domains.  
Retry Mechanism: Retries failed links up to a configurable number of attempts.  
Depth Control: Configurable crawling depth to limit or expand the scope of crawling(-1 for unlimited, 0 for main page only, greater than 0 means crawl the main page and its links up to the specified depth).  
Restart and Retry Modes:  
Restart Mode: Restarts crawling from a saved state.  
Retry Mode: Retries crawling for only failed links from the previous state with html or json request count as -1.  
CSV Integration: Reads input configurations and writes results to CSV files.  
Error Handling: Handles HTTP errors, timeouts, and redirects gracefully.

# Prerequisites

Node.js: Ensure Node.js is installed on your system.  
Dependencies: Install the required dependencies using _**npm install**_.  
Ensure the config.json file is properly configured (see the Configuration section below).

## Configuration

The script uses a config.json file for its configuration. Below are the key parameters:

Key Parameters:  
MAX\_CONNECTIONS: Maximum number of concurrent connections.  
TIMEOUT: Timeout for page loads (in milliseconds).  
RETRY\_COUNT: Number of retry attempts for failed links.  
DEPTH: Crawling depth (0 for main page only, greater than 0 for crawling the main page and its links up to the specified depth, -1 for unlimited crawling till no more pages and links to visit in application).  
HEADLESS: Run browser in headless mode (true or false).  
SEARCH\_CONFIG: Path to the input CSV file containing URLs to crawl.  
CRAWLER\_STATE: Path to the state file for restart or retry modes.  
RESULT\_CSV: Path to the output CSV file for results.  
AUTH: HTTP authentication credentials for specific domains.  
DOMAINS: List of allowed domains to crawl.  

# Usage

*   Set token value for authentication as Token

```java
For Powershell:
$env:access_token="TOKEN-VALUE"
echo $env:MY_VAR

For Windows Command Prompt:
set access_token=TOKEN-VALUE
echo %MY_VAR%

For Linux/MacOS:
export access_token=TOKEN-VALUE

From Jenkins Params:
Values can be set before running the job 
```

*   Run the Crawler

```c
npm run crawler
OR
node crawler.js
```

*   Restart Mode: Restart crawling from the saved state. Backsup old state file and then re-visits all URLs and updates results.

```c
npm run restart
OR
node crawler.js --restart
```

*   Retry Mode: Retry crawling for failed links(html and json count as -1)

```c
npm run retry
OR
node crawler.js --retry
```

**Input and Output**  
Input: search\_config.csv  
The input CSV file should contain the following columns:

<table><tbody><tr><td>Domain</td><td>Path</td><td>parameters</td><td>Login</td></tr></tbody></table>

Output: result.csv  
The output CSV file will contain the following columns:

Domain: The domain of the crawled URL.  
Path: The path of the crawled URL.  
HTML request count: Number of HTML requests made.  
JSON request count: Number of JSON requests made.  
Forwarded: Whether the URL was forwarded.  
Error: Any error encountered during crawling.

<table><tbody><tr><td>Domain</td><td>Path</td><td>HTML request count</td><td>JSON request count</td><td>Forwarded</td><td>Error</td></tr></tbody></table>