import { NO_ACTION } from './sections.js'

// Illustrative demo workspace. All content is fictional and authored locally:
// it never calls Gemini or the backend. Records are flagged `demo: true` and use fixed IDs.
const NO_BLOCKERS = 'No blockers reported in the submitted update.'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const ago = (now, n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)

// [project, reports[]]. endAgo = days before today the reporting period ended.
const DEMO = [
  {
    name: 'Customer Portal Modernisation', startAgo: 150, status: 'On Track', owner: 'Priya Nair', audience: 'Digital Steering Committee',
    description: 'Rebuild the customer self-service portal on a modern front-end stack with single sign-on and a refreshed account dashboard.',
    reports: [
      { endAgo: 16, span: 7, status: 'On Track',
        original: 'login redesign done, SSO design approved by security. dashboard wireframes with UX this week. no blockers. need to book pen test slot for next month.',
        s: 'Customer Portal Modernisation is on track. The redesigned login journey is complete and the single sign-on design has been approved by Security. Dashboard wireframes are in review with UX, and no blockers were reported.',
        done: ['Redesigned login and password-reset journeys completed', 'Single sign-on design approved by the Security team'],
        wip: ['Account dashboard wireframes under review with UX'],
        blk: [NO_BLOCKERS],
        risk: ['Suggested: Penetration test availability could affect the release schedule if a slot is not secured early.'],
        next: ['Finalise dashboard wireframes', 'Book a penetration test slot for next month'], exec: [NO_ACTION] },
      { endAgo: 9, span: 7, status: 'On Track',
        original: 'dashboard build started, SSO integration about 70% done. pen test booked for third week of next month. UX asked to change nav labels, small scope change, absorbed. all good',
        s: 'Customer Portal Modernisation remains on track. Dashboard development has started and single sign-on integration is around 70% complete. A penetration test is booked for the third week of next month, and a minor navigation label change from UX has been absorbed without affecting the schedule.',
        done: ['Dashboard development started', 'Penetration test slot booked for the third week of next month'],
        wip: ['Single sign-on integration, approximately 70% complete', 'Implementing navigation label changes requested by UX'],
        blk: [NO_BLOCKERS],
        risk: ['Suggested: Further navigation changes could add scope if not controlled through change requests.'],
        next: ['Complete single sign-on integration', 'Continue dashboard build'], exec: [NO_ACTION] },
    ],
  },
  {
    name: 'Payment Gateway Integration', startAgo: 110, status: 'Blocked', owner: 'Daniel Okafor', audience: 'CFO and Finance Leadership',
    description: 'Integrate a new payment gateway to support card payments, 3-D Secure authentication and refunds across web and mobile checkout.',
    reports: [
      { endAgo: 12, span: 7, status: 'At Risk',
        original: 'gateway sandbox integration working for cards. 3DS flow in progress. vendor PCI attestation doc still outstanding, chased twice. refunds API not started. could affect go-live',
        s: 'Payment Gateway Integration is at risk. Card payments work in the vendor sandbox and the 3-D Secure flow is in progress, but the vendor has still not supplied its PCI attestation document despite two follow-ups. The refunds API has not started, and the go-live date is under pressure.',
        done: ['Card payment integration working in the vendor sandbox'],
        wip: ['3-D Secure authentication flow'],
        blk: ['Vendor PCI attestation document is outstanding after two follow-ups'],
        risk: ['Go-live date may be affected if the attestation is not received soon', 'Refunds API has not started and may compress later testing time'],
        next: ['Escalate the attestation request with the vendor account manager', 'Start refunds API design'],
        exec: ['Suggested: Executive escalation to the vendor to secure the PCI attestation'] },
      { endAgo: 5, span: 7, status: 'Blocked',
        original: 'still no PCI attestation from vendor. cannot go to security review without it. 3DS done, refunds API 30%. UAT cannot start. go-live in 5 weeks looks unrealistic',
        s: 'Payment Gateway Integration is now blocked. The vendor still has not provided the PCI attestation, so the integration cannot enter security review and UAT cannot start. 3-D Secure is complete and the refunds API is around 30% done. The team considers the go-live date in five weeks unrealistic.',
        done: ['3-D Secure authentication flow completed'],
        wip: ['Refunds API, approximately 30% complete'],
        blk: ['PCI attestation not received from the vendor', 'Security review and UAT cannot start without the attestation'],
        risk: ['Go-live in five weeks is considered unrealistic', 'Suggested: Further delay may compress UAT and security testing into a shorter window.'],
        next: ['Continue refunds API development', 'Re-forecast the go-live date once an attestation date is known'],
        exec: ['Suggested: Executive escalation to the vendor to secure the PCI attestation', 'Suggested: Decision on whether to move the go-live date'] },
    ],
  },
  {
    name: 'Enterprise CRM Migration', startAgo: 200, status: 'At Risk', owner: 'Hannah Reyes', audience: 'Executive Leadership Team',
    description: 'Migrate sales, service and marketing data from the legacy CRM to a new enterprise platform, including training and cut-over.',
    reports: [
      { endAgo: 20, span: 14, status: 'On Track',
        original: 'mapping of accounts and contacts finished. test migration run 1 done, 96% records loaded clean, now fixing the 4% that failed. training plan drafted. no issues.',
        s: 'Enterprise CRM Migration is on track. Account and contact field mapping is finished and the first test migration loaded 96% of records cleanly. The failed records are being fixed and a training plan has been drafted.',
        done: ['Account and contact field mapping finished', 'First test migration completed with 96% of records loaded cleanly', 'Training plan drafted'],
        wip: ['Fixing the 4% of records that failed the first test migration'],
        blk: [NO_BLOCKERS],
        risk: ['Not specified in the submitted update.'],
        next: ['Re-run the test migration after fixes'], exec: [NO_ACTION] },
      { endAgo: 6, span: 14, status: 'At Risk',
        original: 'test migration 2 only 88% clean, legacy duplicates and missing owner fields. data cleansing taking longer than planned. business data owners not responding to review requests. cutover date at risk. need exec to push data owners',
        s: 'Enterprise CRM Migration is at risk. The second test migration loaded only 88% of records cleanly, down from 96%, because of legacy duplicates and missing owner fields. Data cleansing is slower than planned and business data owners are not responding to review requests, which puts the cut-over date at risk.',
        done: ['Second test migration run completed'],
        wip: ['Data cleansing of duplicate and incomplete legacy records'],
        blk: ['Business data owners are not responding to data review requests'],
        risk: ['Cut-over date is at risk due to slower data cleansing', 'Suggested: Poor data quality could affect user adoption after go-live.'],
        next: ['Continue data cleansing', 'Re-run the test migration after cleansing'],
        exec: ['Executive support to require business data owners to complete data reviews'] },
    ],
  },
  {
    name: 'Mobile Application Release', startAgo: 95, status: 'On Track', owner: 'Tomasz Kowalski', audience: 'Product Council',
    description: 'Release version 2 of the customer mobile app on iOS and Android with a redesigned home screen and offline support.',
    reports: [
      { endAgo: 3, span: 7, status: 'On Track',
        original: 'beta with 200 users live, crash free rate 99.4%. top feedback: slow loading on older android. fix in progress. store submission pack 80% ready. all on track',
        s: 'The Mobile Application Release is on track. The beta is live with 200 users and a crash-free rate of 99.4%. The main feedback is slow loading on older Android devices, and a fix is in progress. The store submission pack is around 80% ready.',
        done: ['Beta released to 200 users', 'Crash-free rate of 99.4% achieved in beta'],
        wip: ['Fix for slow loading on older Android devices', 'Store submission pack, approximately 80% ready'],
        blk: [NO_BLOCKERS],
        risk: ['Suggested: Performance on older Android devices could affect store ratings if not resolved before release.'],
        next: ['Release the loading-speed fix', 'Complete and submit the store submission pack'], exec: [NO_ACTION] },
    ],
  },
  {
    name: 'Product Analytics Implementation', startAgo: 60, status: 'On Track', owner: 'Aisha Bello', audience: 'Product and Growth Leads',
    description: 'Implement a product analytics platform with a shared tracking plan, event instrumentation and activation funnel dashboards.',
    reports: [
      { endAgo: 8, span: 7, status: 'On Track',
        original: 'tracking plan signed off by product. 80% of events implemented on web, mobile next. first dashboards for activation funnel built. nothing blocking. consent banner wording needs legal check',
        s: 'Product Analytics Implementation is on track. The tracking plan is signed off, 80% of web events are implemented and the first activation funnel dashboards are built. Mobile instrumentation is next, and the consent banner wording still needs a legal check.',
        done: ['Tracking plan signed off by Product', '80% of web events implemented', 'First activation funnel dashboards built'],
        wip: ['Preparing mobile event implementation'],
        blk: [NO_BLOCKERS],
        risk: ['Suggested: Consent banner wording awaiting legal check could delay release of tracking changes.'],
        next: ['Start mobile event implementation', 'Obtain legal review of the consent banner wording'], exec: [NO_ACTION] },
    ],
  },
  {
    name: 'AI-Powered Support Assistant', startAgo: 75, status: 'At Risk', owner: 'Marcus Lee', audience: 'Customer Support Director',
    description: 'Pilot an AI assistant that helps support agents answer common customer questions using approved knowledge content.',
    reports: [
      { endAgo: 14, span: 7, status: 'On Track',
        original: 'prototype assistant answering top 50 FAQs, internal pilot with 12 agents. evaluation set of 300 questions created. initial accuracy 78%, target is 90%. plan to improve knowledge content',
        s: 'The AI-Powered Support Assistant is on track. A prototype answers the top 50 FAQs and an internal pilot is running with 12 agents. Initial accuracy is 78% against a 90% target, and the team plans to improve the knowledge content.',
        done: ['Prototype assistant answering the top 50 FAQs', 'Evaluation set of 300 questions created'],
        wip: ['Internal pilot with 12 agents', 'Improving knowledge content to raise accuracy'],
        blk: [NO_BLOCKERS],
        risk: ['Initial accuracy of 78% is below the 90% target'],
        next: ['Improve knowledge content', 'Continue the internal pilot'], exec: [NO_ACTION] },
      { endAgo: 4, span: 7, status: 'At Risk',
        original: 'accuracy now 84%, billing questions still poor at 61%. billing knowledge articles out of date, no owner. pilot agents like the tone. need someone to own the knowledge base. 90% by launch at risk',
        s: 'The AI-Powered Support Assistant is at risk. Overall accuracy has improved to 84% but billing questions remain at 61% because the billing knowledge articles are out of date and have no owner. Pilot agents like the assistant’s tone, but the 90% target by launch is at risk.',
        done: ['Accuracy improved from 78% to 84%'],
        wip: ['Internal pilot continuing, with positive agent feedback on tone'],
        blk: ['No owner assigned for the knowledge base', 'Billing knowledge articles are out of date'],
        risk: ['The 90% accuracy target by launch is at risk, with billing questions at 61%'],
        next: ['Update billing knowledge articles once an owner is assigned', 'Re-run the evaluation set'],
        exec: ['Assign an owner for the knowledge base'] },
    ],
  },
  {
    name: 'Digital Onboarding Automation', startAgo: 180, status: 'Off Track', owner: 'Elena Petrova', audience: 'Operations Director',
    description: 'Automate customer onboarding with digital identity verification, document capture and automated account set-up.',
    reports: [
      { endAgo: 10, span: 14, status: 'Off Track',
        original: 'retail journey built and in testing. KYC vendor integration 6 weeks late, vendor API changed. scope grew - added business accounts flow. team of 4 at capacity. original date no longer possible. need re-baseline and decision on scope',
        s: 'Digital Onboarding Automation is off track. The KYC vendor integration is six weeks behind because the vendor changed its API, and the scope has grown with a new business accounts flow. The team is at capacity and the original delivery date is no longer achievable, so the plan needs to be re-baselined.',
        done: ['Retail onboarding journey built and in testing'],
        wip: ['KYC vendor integration, six weeks behind plan', 'Business accounts onboarding flow'],
        blk: ['Vendor API change has delayed the KYC integration'],
        risk: ['The original delivery date is no longer achievable', 'Team is at full capacity, leaving no room for further scope'],
        next: ['Re-baseline the plan with the new scope', 'Agree revised vendor API timelines'],
        exec: ['Decision on approving a re-baselined plan', 'Decision on whether the business accounts flow stays in this release'] },
    ],
  },
  {
    name: 'API Infrastructure Modernisation', startAgo: 130, status: 'Blocked', owner: 'Chidi Eze', audience: 'CTO and Engineering Leadership',
    description: 'Replace legacy point-to-point integrations with a managed API gateway, shared authentication and standard monitoring.',
    reports: [
      { endAgo: 7, span: 7, status: 'Blocked',
        original: 'gateway design complete. staging environment request waiting on cloud platform team approval for 3 weeks. licence budget for API gateway not approved yet. cannot start build. 2 engineers working on docs meanwhile',
        s: 'API Infrastructure Modernisation is blocked. The gateway design is complete, but the staging environment request has been waiting three weeks for cloud platform team approval and the gateway licence budget has not been approved. The build cannot start, and two engineers are working on documentation in the meantime.',
        done: ['API gateway design completed'],
        wip: ['Documentation work while the build is on hold'],
        blk: ['Staging environment request awaiting cloud platform team approval for three weeks', 'API gateway licence budget not yet approved'],
        risk: ['Suggested: Continued delay may leave engineers under-utilised and push back later migration phases.'],
        next: ['Chase the cloud platform team for environment approval', 'Escalate the licence budget approval'],
        exec: ['Approval of the API gateway licence budget', 'Support to unblock the staging environment approval'] },
    ],
  },
  {
    name: 'SaaS Subscription Management', startAgo: 45, status: 'On Track', owner: 'Grace Thompson', audience: 'Finance and Revenue Operations',
    description: 'Configure a subscription billing platform covering plans, pricing tiers, proration, tax and invoicing for the SaaS product.',
    reports: [
      { endAgo: 1, span: 7, status: 'On Track',
        original: 'plans and pricing tiers configured in billing system. proration rules tested. tax config for UK and EU done, US pending. invoice template with finance for sign off. on track',
        s: 'SaaS Subscription Management is on track. Plans, pricing tiers and proration rules are configured and tested, and UK and EU tax configuration is complete. US tax configuration is pending and the invoice template is with Finance for sign-off.',
        done: ['Plans and pricing tiers configured in the billing system', 'Proration rules tested', 'UK and EU tax configuration completed'],
        wip: ['US tax configuration', 'Invoice template awaiting Finance sign-off'],
        blk: [NO_BLOCKERS],
        risk: ['Suggested: A delay in Finance sign-off on the invoice template could affect the testing schedule.'],
        next: ['Complete US tax configuration', 'Obtain Finance sign-off on the invoice template'], exec: [NO_ACTION] },
    ],
  },
  {
    name: 'Document Management System', startAgo: 30, status: 'At Risk', owner: 'Omar Haddad', audience: 'Compliance and Legal',
    description: 'Introduce a document management system with retention rules, version control and audit trails for compliance records.',
    reports: [],
  },
]

const iso = (d) => d.toISOString()

// Build demo records relative to `now` so "recent" dates always look recent.
export function buildDemo(now = new Date()) {
  const projects = []
  const reports = []
  const statusHistory = [] // fictional status changes, flagged demo so Reset Demo removes them
  DEMO.forEach((d, i) => {
    const pid = `demo-p-${pad(i + 1)}`
    const project = {
      id: pid,
      name: d.name,
      startDate: ymd(ago(now, d.startAgo)),
      description: d.description,
      owner: d.owner,
      audience: d.audience,
      status: d.status,
      statusSource: null,
      createdAt: iso(ago(now, d.startAgo)),
      demo: true,
    }
    let previousStatus = null
    let historyCount = 0
    const recordChange = (to, at, source, reportId) => {
      historyCount += 1
      const entry = {
        id: `demo-s-${pad(i + 1)}-${historyCount}`,
        projectId: pid,
        previousStatus,
        previousStatusKnown: true,
        newStatus: to,
        at,
        source,
        reportId,
        demo: true,
      }
      statusHistory.push(entry)
      previousStatus = to
      return entry.id
    }
    d.reports.forEach((r, n) => {
      const end = ago(now, r.endAgo)
      const start = ago(now, r.endAgo + r.span - 1)
      let generated = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 8, 0)
      if (generated > now) generated = new Date(now.getTime() - 60_000)
      const title = `${d.name} – ${r.span === 14 ? 'Fortnightly' : 'Weekly'} Status Report`
      const id = `demo-r-${pad(i + 1)}-${n + 1}`
      reports.push({
        id,
        projectId: pid,
        title,
        originalUpdate: r.original,
        periodStart: ymd(start),
        periodEnd: ymd(end),
        // Demo reports were authored in advance, not generated by the AI: there is no generation time and
        // no original AI output. `savedAt` is the (fictional) date the report is dated.
        savedAt: iso(generated),
        generatedAt: null,
        generatedContent: null,
        generation: null,
        provenance: { generatedAt: 'not-applicable', generatedContent: 'not-applicable', generation: 'not-applicable' },
        updatedAt: null,
        source: 'demo',
        demo: true,
        projectStatusAtReport: r.status,
        content: {
          title,
          executiveSummary: r.s,
          completedActivities: r.done,
          workInProgress: r.wip,
          blockers: r.blk,
          risks: r.risk,
          nextSteps: r.next,
          executiveActionRequired: r.exec,
        },
      })
      // A status change is recorded whenever a report moves the project to a different status.
      if (r.status !== previousStatus) {
        const historyId = recordChange(r.status, iso(generated), 'report', id)
        // The project's current status comes from its latest report; make that source explicit.
        if (n === d.reports.length - 1) project.statusSource = { type: 'report', reportId: id, at: iso(generated), historyId }
      } else if (n === d.reports.length - 1) {
        const last = statusHistory.at(-1)
        project.statusSource = { type: 'report', reportId: id, at: iso(generated), historyId: last?.id }
      }
    })
    if (!project.statusSource) {
      const at = iso(ago(now, 2))
      project.statusSource = { type: 'manual', at, historyId: recordChange(d.status, at, 'manual', null) }
    }
    projects.push(project)
  })
  return { projects, reports, statusHistory, activity: buildDemoActivity(now, projects, reports) }
}

// Sample Recent Activity for the demo workspace: seven entries covering every kind of event, newest first, pointing at
// demo projects and reports that really exist. They are flagged demo (and shown with a Demo badge), have fixed ids so
// loading the demo twice adds nothing, and are removed with the rest of the demo workspace.
function buildDemoActivity(now, projects, reports) {
  const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()
  const lastReport = (pid) => reports.filter((r) => r.projectId === pid).at(-1)
  const byId = (pid) => projects.find((p) => p.id === pid)
  const pick = (status, nth = 0) => projects.filter((p) => p.status === status)[nth] ?? projects[nth]
  const atRisk = pick('At Risk')
  const entries = [
    { kind: 'report-edited', minutes: 18, project: projects[0], report: lastReport(projects[0]?.id) },
    { kind: 'report-saved', minutes: 52, project: projects[2], report: lastReport(projects[2]?.id) },
    { kind: 'report-generated', minutes: 58, project: projects[2], report: lastReport(projects[2]?.id) },
    { kind: 'status-updated', minutes: 3 * 60, project: atRisk, status: atRisk?.status },
    { kind: 'project-updated', minutes: 6 * 60, project: projects[4] },
    { kind: 'project-created', minutes: 26 * 60, project: projects[projects.length - 1] },
    { kind: 'report-saved', minutes: 2 * 24 * 60 + 40, project: projects[1], report: lastReport(projects[1]?.id) },
  ]
  return entries
    .filter((e) => e.project && byId(e.project.id) && (e.kind.startsWith('report') ? e.report : true))
    .map((e, i) => ({
      id: `demo-a-${pad(i + 1)}`,
      kind: e.kind,
      at: at(e.minutes),
      projectId: e.project.id,
      reportId: e.report?.id ?? null,
      status: e.status ?? null,
      demo: true,
    }))
}
