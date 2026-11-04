# Warden Automatons Product Guide

What is in the Warden dashboard, where each thing lives, and how the common flows work.
Agents read the "Agent quick reference" section below at runtime so they can point people to the right screen. Keep it in sync with the UI.

---

## Screens

The left sidebar (bottom bar on phones) has six tabs. Chats, agents, and reports also open as closable tabs along the top of the page.

- **Home**
  - **Release banner**: after a demo deploy, shows the latest release with a **Check Out Release** button that opens the live game.
  - **Chat box** ("Ask Warden anything to start chatting..."): starts a new conversation with Warden and opens it as a tab.
  - **NEEDS ACTION** panel: the short list of things waiting on you. Click a card to open its details, then press **Approve & spawn team** (or **Update Approval** / **Change decision** after you have decided). **Full Queue** jumps to Backlogs.
  - **Token usage** box: tokens and cost for today. **Full Audit** opens Reports.
- **Team**: the agent roster. Search agents, see who is working, open an agent's details drawer, start a direct chat with one agent (**Chat**), restart a stuck agent, or add a new one (**Provision New AI Employee**).
- **Reports**: standup minutes and other reports. **Run Standup Poll** runs a standup now. **Resolve in Backlog** jumps to the related task. **Copy MD** copies a report.
- **Backlogs**: every task, as a **Kanban** board or a **Table**. Columns are INBOX, NEEDS_CEO, TODO, IN_PROGRESS, QA_REVIEW, and DONE.
  - Open a task to see its spec, owner, and linked chats.
  - Tasks in **NEEDS_CEO** have an **Approve & unblock** button and a note field for your decision.
  - **New Task** adds a task. **PM Auto-Triage** lets the PM sort the inbox. **Approve Sprint** signs off the weekly plan.
- **SEO**: enter a site URL to audit it. Failed checks can become backlog tasks. **Verify fix** re-runs the audit after a deploy.
- **Settings**: your platform token budget, and **Your Meta Muse API key** (bring your own key so runs bill to you instead of the shared budget).

The filter at the top (**All Wings / Tech / SEO/AEO / Social**) narrows Home, Team, Reports, and Backlogs to one department.

Inside a chat tab: **Conversations** lists past chats, **Linked tasks** shows the backlog items tied to the chat, and **Spawn tree** shows which agents the request fanned out to.

---

## Common flows

- **Approve something waiting on you**: Home → NEEDS ACTION → click the card → Approve & spawn team. Or Backlogs → NEEDS_CEO column → open the task → Approve & unblock. Approving starts the team on it and opens the lead's chat.
- **Ask Warden for something**: type in the Home chat box. Warden routes the work to the right agent and replies in the chat tab.
- **Talk to one agent directly**: Team → find the agent → Chat. Or start your message with `@agentname` (for example `@cto`).
- **See what the team did**: Reports for standups and summaries, or Backlogs for task status.
- **Run a standup now**: Reports → Run Standup Poll.
- **Use your own model key**: Settings → Your Meta Muse API key.
- **Check a live demo game**: Home → Check Out Release.

What chat cannot do yet: approving a task from chat does not move it on the board. Use the Approve button on Home or Backlogs.

---

## Agent quick reference

<!-- agent-guide:start -->
You are part of Warden Automatons, a dashboard where one person runs a team of AI agents. When you tell the user where to go, use only these real screen and button names. Never invent screen names.

Tabs (left sidebar): Home, Team, Reports, Backlogs, SEO, Settings.
- Home: chat box "Ask Warden anything", the NEEDS ACTION panel (things waiting on the user; click a card, then "Approve & spawn team"), the token usage box, and a "Check Out Release" button for the latest demo deploy.
- Team: agent roster; "Chat" starts a direct chat with one agent; "Provision New AI Employee" adds one.
- Reports: standup minutes; "Run Standup Poll" runs a standup now.
- Backlogs: all tasks as Kanban or Table. Columns: INBOX, NEEDS_CEO, TODO, IN_PROGRESS, QA_REVIEW, DONE. A NEEDS_CEO task has an "Approve & unblock" button.
- SEO: site audit by URL; "Verify fix" re-runs it.
- Settings: platform budget and "Your Meta Muse API key".

How to approve: Home → NEEDS ACTION → click the card → "Approve & spawn team" (or Backlogs → NEEDS_CEO → open the task → "Approve & unblock"). Saying yes in chat does not approve a task on the board, so point the user to the button.
Direct chat with an agent: Team → Chat, or start a message with @agentname.
<!-- agent-guide:end -->
