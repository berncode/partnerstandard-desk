# The file format

Everything you write in PartnerStandard Desk is kept as workbooks: tabs of rows and columns, like a spreadsheet. Both editions keep the same workbooks, with the same tabs in the same order, so any tool can read your work. This page says what is in them.

## Where the workbooks are

- **Hosted:** in your own Google Drive, as Google Sheets, in the folder PartnerStandard / PartnerStandard Desk. An account made before the new name keeps its folder, PartnerStandard / Partner Desk; the files it made then keep the name `Partner Desk – …`, and its business cases from then the field `Partner Desk type`. Files made since carry the new name. Open them with Google Sheets or read them with the Google Sheets API. The `_meta` tab is hidden and protected there.
- **On your own server:** in the database, in the table `work_files`, one row per workbook. `body` is the workbook as JSON: each tab's name to its rows of cells. `kind` says which workbook it is; `format_version` is a copy of the version in `_meta`, which is the one the app reads. A deleted workbook keeps its row with `trashed_at` set: skip those. The app's **Download as a spreadsheet** gives the same workbook as an `.xlsx` file, to read.

## Reading them

- **Every workbook has a `_meta` tab**, with the columns `key` and `value`: its format version (`schemaVersion`), its ids and `createdWith`. A file without it, or without a whole-number version or its ids, is not one of ours, and the app leaves it alone.
- **Ids and references:** a table's `ID` (or `Id`) column holds each row's id. A column that names another row holds that row's id: `Partner account` an Accounts id, `Partner` a Partners id, `Market` a market's id, `Review ID` a review's id. Two exceptions in a MAP: `Owner` holds a person's name and `Milestone` a milestone's name.
- **Values:** dates as `2026-11-09`, times as `2026-11-09T14:30:00.000Z` (UTC), amounts as plain numbers, 4C scores from 0 to 3. A choice from a list is the label the app shows (for example `Confirmed`); the labels are in `packages/copy/src/option-labels.ts` and `packages/method`.
- **Yes or no:** Partners, market and MAP files write `yes` or leave the cell empty. Program, Company facts and business case files write `Yes` or `No`, and a few case settings `On` or `Off`.
- **Several values in one cell:** `Value points` holds ids separated by commas; `Must-haves` one item per line.
- **Tabs for people:** `Start here`, `Program Sheet` and `Public page` are written for people to read. The app never reads them back.

## Writing them

Reading changes nothing. Writing is for an admin who knows what a change does: the workbooks are the app's database, on Google Drive and on a company server alike. If a tool of yours writes:

- **Keep the tabs' names, the headers, the ids and `_meta` as they are.**
- **Ids are unique in the whole file**, not only in their tab (Partners, market and MAP files). A row with an empty id gets one from the app on its next save.
- **Columns are found by their header,** so their order may change, and a column the app doesn't know is left as it is. Not so on the field tabs `Market` (a market) and `Plan` (a MAP), nor in `_meta`: there the name stays in column A and the value in B.
- **On a field tab** (`Setting` and `Value`) of a program, Company facts or business case, one value the app can't read makes the whole file unreadable until it is fixed. In a table, a row it can't read is left out and never overwritten; the screen shows it as needing attention.
- **The app reads the file again before each save** and changes only what it saves.
- **On a company server,** write the row in `work_files` and raise its `revision` by one in the same statement: the app saves only if `revision` is still the one it read, so a save of the app's never overwrites yours, nor yours the app's.
- **A newer format** comes with an update of the app. The app brings each file up to date the next time it saves it. A file from a newer version than the app knows is not read at all.

## The workbooks

<!-- generated: the workbooks (packages/storage/src/file-format.test.ts) -->

### Partners (`partners`)

Format version 5. The app also reads versions 2 to 4, and brings such a file up to date on its next save. An older one is not read.

| Tab | Holds |
| --- | --- |
| `Start here` | For people to read: the app writes it and never reads it back. |
| `Accounts` | One row each, found by its id, under the columns `ID`, `Company`, `Website`, `Country`, `Vertical`, `Sub-vertical`, `Target customer type`, `Comments`, `Updated`, `Updated by`. |
| `Partners` | One row each, found by its id, under the columns `ID`, `Partner account`, `Partner type`, `Stage`, `Step`, `Closed`, `Closed reason`, `Source`, `Source detail`, `Why it fits`, `Desk: Customer base`, `Desk: Credibility`, `Desk: Capability`, `Desk: Commitment`, `Confirmed: Customer base`, `Confirmed: Credibility`, `Confirmed: Capability`, `Confirmed: Commitment`, `MAP filled in`, `MAP link`, `Signed date`, `Exited date`, `Exit reason`, `Program`, `Level`, `MAP health`, `Next milestone`, `Updated`, `Updated by`. |
| `Market links` | One row each, found by its id, under the columns `ID`, `Partner`, `Market`, `Partner hypothesis`, `Updated`, `Updated by`. |
| `People` | One row each, found by its id, under the columns `ID`, `Partner account`, `Name`, `Title`, `Email`, `Role`, `Active seller`, `Updated`, `Updated by`. |
| `Calls` | One row each, found by its id, under the columns `ID`, `Partner`, `Date`, `Kind`, `Revenue Model`, `Cost Drivers`, `Differentiators`, `Strategic Bets`, `Customer Pains`, `Partnership Experience`, `Notes`, `Updated`, `Updated by`. |
| `Qualification` | One row each, found by its id, under the columns `ID`, `Partner`, `Desk note: Customer base`, `Desk note: Credibility`, `Desk note: Capability`, `Desk note: Commitment`, `Confirmed note: Customer base`, `Confirmed note: Credibility`, `Confirmed note: Capability`, `Confirmed note: Commitment`, `Q1: Customer overlap`, `Q2: Deal fit`, `Q4: MAP agreed`, `CASO: Culture`, `CASO: Culture note`, `CASO: Additional value`, `CASO: Additional value note`, `CASO: Sponsorship`, `CASO: Sponsorship note`, `CASO: Aligned objectives`, `CASO: Aligned objectives note`, `Updated`, `Updated by`. |
| `Proposals` | One row each, found by its id, under the columns `ID`, `Proposal ID`, `Kind`, `Partner account`, `Partner`, `Market`, `Partner hypothesis`, `About`, `What`, `Proposed`, `Details`, `Evidence or reason`, `Proposed by`, `Status`, `Answer note`, `Proposed on`, `Answered on`, `Expires on`, `Target updated`, `Updated`, `Updated by`. |
| `_meta` | The file's own facts, under the columns `key`, `value`, one per row: `schemaVersion`, `companyId`, `createdWith`. |

### A market (`market`)

Format version 2. The app also reads version 1, and brings such a file up to date on its next save. An older one is not read.

| Tab | Holds |
| --- | --- |
| `Start here` | For people to read: the app writes it and never reads it back. |
| `Market` | One field per row, under the columns `Field`, `Value`, `Check again`, found by position, in this order. Its fields: `Market`, `Partner type`, `Feeds program`, `Our product`, `Our target customers`, `Why the partner route works`, `Must-haves`, `How the market buys`, `How the market buys: note`, `Statement`, `Expected partners`, `Status`, `Status note`, `Copied from`, `Updated`, `Updated by`. |
| `Value proposition` | One row each, found by its id, under the columns `ID`, `Kind`, `Value point`, `State`, `Evidence`, `Check again`, `Updated`, `Updated by`. |
| `Partner hypotheses` | One row each, found by its id, under the columns `ID`, `Name`, `Their side`, `Their evidence`, `Our side`, `Our evidence`, `Value points`, `Companies like this one`, `Status`, `Check again`, `Updated`, `Updated by`. |
| `Exclusions` | One row each, found by its id, under the columns `ID`, `Company`, `Website`, `Reason`, `Updated`, `Updated by`. |
| `Changes` | One row each, found by its id, under the columns `ID`, `Date`, `About`, `About ID`, `What changed and why`, `Call`, `Updated`, `Updated by`. |
| `_meta` | The file's own facts, under the columns `key`, `value`, one per row: `schemaVersion`, `marketId`, `companyId`, `createdWith`. |

### A program (`program`)

Format version 1.

| Tab | Holds |
| --- | --- |
| `Program Sheet` | For people to read: the app writes it and never reads it back. |
| `Program` | One field per row, under the columns `Setting`, `Value`, found by header. Its fields: `Id`, `Company`, `Partner type`, `Program name`, `Focus`, `Program lead`, `What you want to achieve`, `Description for partners`, `Ideal partner`, `Ideal customer`, `How you measure the program`, `Training and material`, `Tools`, `Registered: name of the level`, `Preferred level`, `Preferred: name of the level`, `Notice before moving a partner down (days)`, `Improvement plan with milestones first`, `Pilot partners`, `Publish the criteria on`, `Paid as`, `Commission`, `Paid on`, `First contract runs (years)`, `Registered: first year (%)`, `Registered: renewals (%)`, `Registered: one-off (%)`, `Preferred: first year (%)`, `Preferred: renewals (%)`, `Preferred: one-off (%)`, `Registered: flat fee`, `Preferred: flat fee`, `Rewards instead of cash`, `Paid`, `Paid within (days)`, `Partner manager time`, `Funds for partner marketing`, `Training, material and tools`, `New customers you expect from it`, `Updated`. |
| `Reasons` | A list, kept whole: one row each, in order, under the columns `Reason`. |
| `Entry` | A list, kept whole: one row each, in order, under the columns `What it takes`. |
| `Benefits` | One row each, found by its `Key`, under the columns `Benefit`, `Group`, `Registered`, `Preferred`, `Own`, `Key`. |
| `Requirements` | One row each, found by its `Requirement`, under the columns `Requirement`, `On`, `People`. |
| `Performance bar` | A list, kept whole: one row each, in order, under the columns `Measure`, `At least`, `Unit`. |
| `Public page` | For people to read: the app writes it and never reads it back. |
| `_meta` | The file's own facts, under the columns `key`, `value`, one per row: `schemaVersion`, `companyId`, `programId`, `createdWith`. |

### Company facts (`companyFacts`)

Format version 2. The app also reads version 1, and brings such a file up to date on its next save. An older one is not read.

| Tab | Holds |
| --- | --- |
| `Company facts` | One field per row, under the columns `Setting`, `Value`, found by header. Its fields: `Id`, `Currency`, `Pays every year`, `Pays once`, `Customers who renew (%)`, `Sales and marketing, last year`, `Revenue, last year`, `A registered deal is protected (days)`, `Extension while working on it (days)`, `You answer within (hours)`, `When two register the same customer`, `Partner paid in full if your own team closes the deal`, `Who keeps the customer`, `Handover to your sales team`, `Updated`, `Gross margin (%)`, `Gross margin source`, `Finding a lead`, `Closing a deal`, `Sales source`, `Support level 1 a year`, `Support level 2 a year`, `Support source`, `Services: our cost`, `Services: what we charge`, `Services source`. |
| `Our cost lines` | One row each, found by its id, under the columns `Cost`, `When`, `Amount`, `Source`, `Id`. |
| `_meta` | The file's own facts, under the columns `key`, `value`, one per row: `schemaVersion`, `companyId`, `createdWith`. |

### A business case (`businessCase`)

Format version 1.

| Tab | Holds |
| --- | --- |
| `Offer` | One field per row, under the columns `Setting`, `Value`, found by header. Its fields: `Company`, `Currency`, `Customers who renew (%)`, `Preferred conditions`, `Preferred when`, `Preferred deals a year`, `Preferred revenue a year`, `Preferred from year`, `Registered level name`, `Preferred level name`. |
| `Products` | One row each, found by its id, under the columns `Product`, `Paid`, `Price`, `Per`, `Amount`, `Id`. |
| `Partner type` | One row, written in place, under the columns `Partner type`, `Brings the lead (%)`, `Closes and invoices`, `Customer support`, `Delivers services`, `Registered: first year (%)`, `Registered: renewals (%)`, `Registered: one-off (%)`, `Registered: your share of services (%)`, `Preferred: first year (%)`, `Preferred: renewals (%)`, `Preferred: one-off (%)`, `Preferred: your share of services (%)`, `Partner fee a year`, `Id`. |
| `Case` | One field per row, under the columns `Setting`, `Value`, found by header. Its fields: `Id`, `Title`, `Partner`, `Partner type`, `Partner type id`, `PartnerStandard Desk type`, `Type id`, `Program id`, `Made on`, `Stage when made`, `Recalculated on`, `Starts as`, `Deals year 1`, `Deals year 2`, `Deals year 3`, `Deals year 4`, `Deals year 5`, `Scenario`, `Implementation`, `Managed service a month`, `Other sales`, `Partner profit on services (%)`, `Partner support cost a year`, `Benefits`, `Notes`, `Shared on`, `Updated`. |
| `Costs` | One row each, found by its id, under the columns `Side`, `Cost`, `When`, `Amount`, `Source`, `Id`. |
| `Our case` | One field per row, under the columns `Setting`, `Value`, found by header. Its fields: `Gross margin (%)`, `Gross margin source`, `Finding a lead`, `Closing a deal`, `Sales source`, `Support level 1 a year`, `Support level 2 a year`, `Support source`, `Services: our cost`, `Services: what we charge`, `Services source`, `Deals won anyway (%)`, `Deals won anyway source`, `Deal plan source`, `More efficient`, `More efficient: simplified or detailed`, `More efficient: from year`, `More efficient: source`, `More efficient: note`, `More efficient: also if we go alone`, `More efficient: worth a year`, `More efficient: hours freed a year`, `More efficient: cost per hour`, `Less churn`, `Less churn: simplified or detailed`, `Less churn: from year`, `Less churn: source`, `Less churn: note`, `Less churn: also if we go alone`, `Less churn: revenue kept a year`, `Less churn: customers affected`, `Less churn: revenue per customer a year`, `Less churn: churn today (%)`, `Less churn: churn with the partner (%)`, `Alone: simplified or detailed`, `Alone: deals (% of the plan)`, `Alone: months later`, `Alone: set-up cost`, `Alone: fixed cost a year`, `Alone: source`, `Alone: deals year 1`, `Alone: deals year 2`, `Alone: deals year 3`, `Alone: deals year 4`, `Alone: deals year 5`, `Don't do it: revenue at risk a year`, `Don't do it: from year`, `Don't do it: source`, `Don't do it: why`, `Recommendation`, `Ask`, `Prepared by`. |
| `Strategic reasons` | One row each, found by its id, under the columns `Reason`, `Matters`, `Alone too`, `Id`. |
| `_meta` | The file's own facts, under the columns `key`, `value`, one per row: `schemaVersion`, `companyId`, `caseId`, `createdWith`. |

### A MAP (`map`)

Format version 3. The app also reads versions 1 and 2, and brings such a file up to date on its next save. An older one is not read.

| Tab | Holds |
| --- | --- |
| `Start here` | For people to read: the app writes it and never reads it back. |
| `Plan` | One field per row, under the columns `Field`, `Value`, found by position, in this order. Its fields: `Partner type id`, `Partner type`, `Horizon length`, `Later horizons`, `Next review`. |
| `Objectives` | One row each, found by its id, under the columns `ID`, `Side`, `Objective`, `How we’ll know`. |
| `Activities` | One row each, found by its id, under the columns `ID`, `Activity`, `Category`, `Side`, `Owner`, `Due date`, `Status`, `Completed date`, `Milestone`, `Note`, `Last updated`, `Updated by`. |
| `People` | One row each, found by its id, under the columns `ID`, `Side`, `Name`, `Title`, `Email`, `Role`. |
| `Milestones` | One row each, found by its id, under the columns `ID`, `Milestone`, `Target date`, `Success criteria`, `Achieved date`. |
| `Exit Triggers` | One row each, found by its id, under the columns `ID`, `Condition`, `Status`. |
| `Reviews` | One row each, found by its id, under the columns `ID`, `Horizon`, `State`, `Held on`, `Business case ID`, `Decisions`, `Relationship note`, `Next horizon (days)`, `Scorecard in summary`, `Summary sent`, `Sent to`, `Last updated`, `Updated by`. |
| `Review numbers` | One row each, found by its id, under the columns `ID`, `Review ID`, `Number`, `Actual`, `Target`, `Source`, `Note`, `Next target`. |
| `Review items` | One row each, found by its id, under the columns `ID`, `Review ID`, `Kind`, `Activity or hypothesis ID`, `Title`, `Side`, `Owner`, `Due date`, `Milestone`, `Answer`, `Note`, `Moved to the plan`. |
| `_meta` | The file's own facts, under the columns `key`, `value`, one per row: `schemaVersion`, `companyId`, `createdWith`. |

<!-- end of generated -->
