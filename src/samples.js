// Prepared, fictional sample scenario. Used by "Try a Sample Generation" and the sample preview.
// Everything here is authored locally: it is never sent to a server or to Gemini.
// The report only states things the update says; anything beyond it is prefixed "Suggested:",
// exactly as the live AI is instructed to do.
export const SAMPLE_SCENARIO = {
  key: 'sample:customer-portal',
  projectName: 'Customer Portal',
  defaultDemoProjectId: 'demo-p-01',
  update:
    "Finished the login API and unit tests. Dashboard UI about 60% done, waiting on final icons from design. Payment integration blocked - vendor sandbox keys still not received after 2 weeks. QA found 3 flaky tests in checkout. Launch date of the 15th might slip if keys don't arrive. Next: finish dashboard, start reporting module, chase vendor.",
  report: {
    title: 'Customer Portal – Weekly Status Report',
    executiveSummary:
      'The Customer Portal project is progressing, but the 15th launch date may slip. The login API and its unit tests are complete and the dashboard UI is about 60% done, waiting on final icons from design. Payment integration is blocked because the vendor sandbox keys have not arrived after two weeks.',
    completedActivities: ['Login API completed', 'Login API unit tests completed'],
    workInProgress: [
      'Dashboard UI, approximately 60% complete, waiting on final icons from design',
      'Three flaky checkout tests found by QA (status of fixes not specified)',
    ],
    blockers: [
      'Payment integration blocked: vendor sandbox keys not received after two weeks',
      'Dashboard UI waiting on final icons from design',
    ],
    risks: [
      'The 15th launch date may slip if the vendor sandbox keys do not arrive',
      'Suggested: The three flaky checkout tests could hide defects if left unresolved.',
    ],
    nextSteps: ['Finish the dashboard', 'Start the reporting module', 'Chase the vendor for the sandbox keys'],
    executiveActionRequired: [
      'Suggested: Escalate to the vendor’s senior contact to secure the sandbox keys',
      'Suggested: Confirm whether the 15th launch date is fixed or can move if the keys are delayed',
    ],
  },
}

// A believable recent week (ending yesterday) so the sample looks current whenever it is opened.
export function samplePeriod(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
  return { periodStart: ymd(start), periodEnd: ymd(end) }
}
