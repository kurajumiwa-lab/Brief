// Original Wairo editorial guidance. Not customer activity or case studies.
export const PLAYBOOKS = [
  {
    id: 'choose-software',
    title: 'Choose software without buying blind',
    summary:
      'A small shortlist. A real-world trial. One decision you can explain.',
    topic: 'software',
    stages: ['starting', 'growing', 'established'],
    steps: [
      [
        'Name the job',
        'Write the one recurring problem you need to solve, who does it today, and what a better outcome would look like.'
      ],
      [
        'Set the full budget',
        'Include setup, training, subscriptions, payment fees and data export—not just the advertised monthly price.'
      ],
      [
        'Test with a real workflow',
        'Ask two or three providers to demonstrate the same task using non-sensitive sample data. Check device, connectivity and support requirements.'
      ],
      [
        'Check your exit',
        'Confirm data ownership, export formats, cancellation terms and who can access your business records.'
      ],
      [
        'Start small',
        'Pilot with one person or team. Agree on a review date before expanding or hiring someone to set it up.'
      ]
    ],
    action: { label: 'Find tools', filter: 'tool' }
  },
  {
    id: 'outreach-sprint',
    title: 'Your first outreach sprint, without the spam',
    summary:
      'Define a useful offer, a small audience and an outcome you can verify.',
    topic: 'sales',
    stages: ['starting', 'growing'],
    steps: [
      [
        'Choose one audience',
        'Pick a business type and a specific need. Use appropriate, lawfully obtained contact details and respect opt-outs.'
      ],
      [
        'Make one useful offer',
        'Offer a relevant demo or a short conversation, not an unsubstantiated promise. Say who you are and why you are contacting them.'
      ],
      [
        'Define the work',
        'Specify the permitted channels, audience, deadline and evidence. An attempted call, an opted-in demo and a paying customer are different outcomes.'
      ],
      [
        'Agree on acceptance',
        'Set a stated fee and review process for the agreed outcome. Do not treat a submitted screenshot as an approved result or a payment.'
      ],
      [
        'Review the pilot',
        'Count the actual attempts and accepted outcomes. Ask what failed before increasing volume. Never publish customer names or claims without permission.'
      ]
    ],
    action: { label: 'Scope a request', href: '/#requests/new' }
  },
  {
    id: 'brief-a-task',
    title: 'Write a task someone can actually finish',
    summary:
      'Turn “help my business” into a clear brief, evidence and an acceptance decision.',
    topic: 'operations',
    stages: ['starting', 'growing', 'established'],
    steps: [
      [
        'Describe the outcome',
        'State the deliverable, quantity, deadline and what is outside the scope. Share only the information a provider needs.'
      ],
      [
        'Choose the working mode',
        'A remote task should not require GPS. Field work may need an agreed location or photographs; evidence requirements follow the task template.'
      ],
      [
        'Agree on terms',
        'Confirm capability, availability, scope, price and acceptance criteria before work starts. A match is a possible fit, not a verified promise.'
      ],
      [
        'Review and close',
        'Check the agreed evidence, record approval or a reason for revision, and follow the existing payment process. Do not share sensitive proof publicly.'
      ]
    ],
    action: { label: 'Create a request', href: '/#requests/new' }
  },
  {
    id: 'honest-reviews',
    title: 'Ask for feedback. Not five stars.',
    summary:
      'Make customer experience useful to the next person, even when it is critical.',
    topic: 'marketing',
    stages: ['growing', 'established'],
    steps: [
      [
        'Ask after a real experience',
        'Invite customers to explain what they tried, what worked and what did not. Do not write a review on their behalf.'
      ],
      [
        'Keep it voluntary',
        'Never condition a refund, service or benefit on a positive rating. Disclose any incentive and do not selectively suppress negative feedback.'
      ],
      [
        'Protect their privacy',
        'Ask permission before sharing customer stories or images. Remove private documents, personal details and sensitive photo metadata.'
      ],
      [
        'Respond constructively',
        'Acknowledge the experience, offer a helpful next step and keep account or order details out of public replies. Measure improvements, not just stars.'
      ]
    ],
    action: { label: 'Explore customer reviews', href: '/reviews' }
  }
];
