# WorkLeak

WorkLeak is an internal operations intelligence tool that helps teams find where work is leaking time and money.

It scans workflow data from tickets, meetings, and pull requests, identifies high-friction patterns, estimates their business cost, and turns the highest-impact leaks into practical action plans.

## Demo

YouTube demo link: **[Add YouTube demo link here]()**

## Why WorkLeak Was Created

WorkLeak was created from a simple but expensive question:

> Why do we keep doing this manually?

Across past work experiences, many operational problems were not caused by careless teams. They were caused by small leaks scattered across tools and workflows: delayed approvals, repeated updates, duplicated reports, blocked reviews, and meetings that created more work than they resolved.

These problems rarely appear expensive on their own. But when they repeat every week across multiple teams, the cost becomes meaningful. WorkLeak was built to make that hidden operational drag visible, measurable, and actionable.

## What The App Does

WorkLeak analyzes workflow data and detects patterns such as:

- Long wait times
- Too many handoffs
- Repeated manual work
- Blocked tickets or pull requests
- Duplicate meetings and reports
- Pull requests waiting too long for review
- Meetings with no clear outcomes

For each detected leak, WorkLeak estimates business impact using:

```txt
Monthly Cost = Hours Lost Per Month x Average Hourly Cost
```

It then ranks the most valuable fixes using savings, confidence, implementation effort, and payback period.

## How WorkLeak Helps

WorkLeak helps teams move from vague frustration to clear decisions:

- Shows where time is being wasted
- Estimates how much each workflow leak costs
- Highlights healthy workflows that were ignored
- Ranks which problem to fix first
- Converts findings into manager-ready action plans
- Generates Jira-ready ticket text and automation recipes
- Saves reports to a private Firestore workspace
- Keeps raw CSV data local in the browser for the prototype

The goal is simple: help teams know what to fix first.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn-style UI components
- Firebase Authentication
- Cloud Firestore
- Gemini API through a Vercel serverless route
- Recharts
- localStorage for prototype state persistence
- Vercel deployment

## Accounts And Credentials

No shared account credentials are required.

Users can create an account directly in the app using email/password authentication. Once signed in, users can save WorkLeak reports to their own private Firestore workspace.

## How The Demo Works

1. Open WorkLeak.
2. Create an account or sign in from the top-right navbar.
3. Go to **Import**.
4. Click **Load Sample Data** or upload CSV files for tickets, meetings, and pull requests.
5. Go to **Dashboard**.
6. Review the executive snapshot:
   - Adjusted monthly waste
   - Recoverable savings
   - FTE recovered
   - Workflow health score
   - Source health
7. Review **Fix This First** to see the highest-ROI workflow improvements.
8. Explore **Leak Fingerprints** such as Approval Black Hole, Ticket Ping-Pong, PR Waiting Room, and Manual Report Tax.
9. Open **Action Plan**.
10. Review the top recommended fixes, owners, payback, next steps, and automation recipes.
11. Optionally generate a Gemini-powered action plan for a finding.
12. Copy Jira ticket text, copy summaries, or export Markdown, JSON, or CSV.
13. Go to **Settings**.
14. Adjust average hourly cost and recovery assumptions.
15. Click **Save report to Firestore** to save the analysis snapshot.

## Challenges Faced

The hardest part was turning vague workplace frustration into something measurable.

It is easy to say a process feels slow. It is harder to show that a workflow costs a team hours per month, delays customer onboarding, or creates avoidable review bottlenecks. WorkLeak had to convert messy operational signals into estimates that feel credible to a business audience.

Another challenge was avoiding inflated impact numbers. A single workflow item can trigger multiple leak signals, so WorkLeak uses adjusted waste to reduce overlap and keep the business story more honest.

It was also important to make the recommendations useful. WorkLeak is not meant to simply point at problems. It suggests practical fixes such as clearer ownership, templates, automation rules, approval thresholds, and async workflow changes.

Finally, adding authentication and Firestore persistence required balancing product realism with privacy. The prototype saves reports and findings, but raw CSV files stay local in the browser.

## Future Improvements

Planned improvements include:

- Multi-company and team workspaces
- Role-based access for executives, managers, and team leads
- Real Jira, GitHub, Slack, and Google Calendar integrations
- Scheduled weekly leak reports
- Trend tracking over time
- Backend-owned audit logs
- Server-side analysis jobs
- More advanced Firestore validation or server-side writes
- Saved historical reports and comparison views
- One-click Jira issue creation
- Slack alerts when new workflow leaks appear
- Department-level benchmarking
- SSO and enterprise security controls
- Data retention controls for sensitive company data

Long term, WorkLeak could become a continuous improvement system for internal operations: always watching for operational drag, always ranking the highest-impact fixes, and helping teams recover time before it disappears.
