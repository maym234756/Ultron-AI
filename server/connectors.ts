export type ConnectorAuthMode = 'browser' | 'api' | 'oauth'
export type ConnectorCategory = 'crm' | 'email' | 'spreadsheet' | 'video' | 'productivity' | 'commerce' | 'support' | 'developer' | 'database' | 'storage' | 'communications' | 'social' | 'marketing' | 'finance' | 'design' | 'cloud' | 'automation' | 'documents' | 'generic'

export type ConnectorEntry = {
  id: string
  label: string
  category: ConnectorCategory
  aliases: string[]
  homeUrl: string
  authModes: ConnectorAuthMode[]
  capabilities: string[]
  sensitiveActions: string[]
  requiredTools: string[]
  apiEnvVars: string[]
}

export type ConnectorStatus = ConnectorEntry & {
  apiConfigured: boolean
  browserSupported: boolean
  missingTools: string[]
  status: 'api-ready' | 'browser-ready' | 'setup-needed'
  detail: string
}

export type ConnectorStatusSnapshot = {
  checkedAt: number
  total: number
  apiReady: number
  browserReady: number
  setupNeeded: number
  connectors: ConnectorStatus[]
}

const BROWSER_TOOLS = ['browser_connect_chrome', 'browser_go', 'browser_click', 'browser_type', 'browser_read']
const HTTP_TOOLS = ['http_request']

export const CONNECTOR_REGISTRY: ConnectorEntry[] = [
  {
    id: 'salesforce',
    label: 'Salesforce',
    category: 'crm',
    aliases: ['salesforce', 'sf', 'sfdc', 'crm'],
    homeUrl: 'https://login.salesforce.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search accounts/leads/opportunities', 'log activities', 'draft or update CRM records after approval'],
    sensitiveActions: ['creating records', 'updating records', 'deleting records', 'sending customer messages'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['SALESFORCE_ACCESS_TOKEN', 'SALESFORCE_INSTANCE_URL', 'SALESFORCE_CLIENT_ID'],
  },
  {
    id: 'gmail',
    label: 'Gmail',
    category: 'email',
    aliases: ['gmail', 'google mail', 'mail.google.com'],
    homeUrl: 'https://mail.google.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read inbox threads', 'summarize email', 'draft replies and send only after approval'],
    sensitiveActions: ['sending email', 'deleting email', 'moving messages', 'changing labels'],
    requiredTools: [...BROWSER_TOOLS, 'browser_read_emails', 'browser_click_email', 'browser_compose_reply'],
    apiEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GMAIL_ACCESS_TOKEN'],
  },
  {
    id: 'google-sheets',
    label: 'Google Sheets',
    category: 'spreadsheet',
    aliases: ['google sheets', 'sheets', 'spreadsheet', 'sheets.google.com'],
    homeUrl: 'https://sheets.google.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read rows', 'append records', 'update cells after approval'],
    sensitiveActions: ['editing cells', 'deleting rows', 'sharing files', 'changing permissions'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    category: 'video',
    aliases: ['youtube', 'youtube studio', 'yt', 'studio.youtube.com'],
    homeUrl: 'https://www.youtube.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search videos', 'summarize transcripts', 'review channel or Studio pages'],
    sensitiveActions: ['posting comments', 'editing metadata', 'uploading videos', 'deleting content'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['YOUTUBE_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_REFRESH_TOKEN'],
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    category: 'productivity',
    aliases: ['google drive', 'drive', 'drive.google.com'],
    homeUrl: 'https://drive.google.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['find files', 'summarize documents', 'organize folders after approval'],
    sensitiveActions: ['deleting files', 'sharing files', 'moving folders', 'changing permissions'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
  },
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    category: 'productivity',
    aliases: ['google calendar', 'calendar', 'gcal', 'calendar.google.com'],
    homeUrl: 'https://calendar.google.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read schedule', 'draft events', 'summarize availability'],
    sensitiveActions: ['creating events', 'deleting events', 'inviting attendees', 'changing meetings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
  },
  {
    id: 'outlook',
    label: 'Outlook',
    category: 'email',
    aliases: ['outlook', 'office mail', 'microsoft mail', 'outlook.com'],
    homeUrl: 'https://outlook.live.com/mail',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read email', 'summarize threads', 'draft replies after approval'],
    sensitiveActions: ['sending email', 'deleting messages', 'moving messages', 'changing rules'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REFRESH_TOKEN'],
  },
  {
    id: 'slack',
    label: 'Slack',
    category: 'productivity',
    aliases: ['slack', 'slack workspace'],
    homeUrl: 'https://slack.com/signin',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search channels', 'summarize threads', 'draft messages after approval'],
    sensitiveActions: ['sending messages', 'inviting users', 'changing channels', 'deleting messages'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['SLACK_BOT_TOKEN', 'SLACK_USER_TOKEN'],
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    category: 'crm',
    aliases: ['hubspot', 'hub spot'],
    homeUrl: 'https://app.hubspot.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search contacts/companies/deals', 'summarize pipelines', 'draft CRM updates'],
    sensitiveActions: ['creating records', 'updating records', 'deleting records', 'sending marketing email'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_PRIVATE_APP_TOKEN'],
  },
  {
    id: 'notion',
    label: 'Notion',
    category: 'productivity',
    aliases: ['notion', 'notion workspace'],
    homeUrl: 'https://www.notion.so/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read pages/databases', 'summarize workspaces', 'draft page updates'],
    sensitiveActions: ['editing pages', 'deleting pages', 'sharing pages', 'changing database properties'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['NOTION_TOKEN', 'NOTION_API_KEY'],
  },
  {
    id: 'airtable',
    label: 'Airtable',
    category: 'database',
    aliases: ['airtable', 'air table'],
    homeUrl: 'https://airtable.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read bases', 'summarize records', 'draft row updates'],
    sensitiveActions: ['editing records', 'deleting records', 'changing schema', 'sharing bases'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['AIRTABLE_API_KEY', 'AIRTABLE_ACCESS_TOKEN'],
  },
  {
    id: 'shopify',
    label: 'Shopify',
    category: 'commerce',
    aliases: ['shopify', 'shopify admin'],
    homeUrl: 'https://admin.shopify.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review orders', 'summarize products', 'draft product updates'],
    sensitiveActions: ['editing products', 'issuing refunds', 'changing orders', 'publishing content'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_SHOP_DOMAIN'],
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    category: 'commerce',
    aliases: ['quickbooks', 'quick books', 'qbo'],
    homeUrl: 'https://app.qbo.intuit.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review invoices', 'summarize expenses', 'draft accounting entries'],
    sensitiveActions: ['creating invoices', 'changing payments', 'editing customers', 'deleting transactions'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_REFRESH_TOKEN'],
  },
  {
    id: 'jira',
    label: 'Jira',
    category: 'developer',
    aliases: ['jira', 'atlassian jira'],
    homeUrl: 'https://id.atlassian.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search issues', 'summarize sprint work', 'draft issue updates'],
    sensitiveActions: ['changing issue status', 'editing tickets', 'deleting tickets', 'changing project settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
  },
  {
    id: 'github',
    label: 'GitHub',
    category: 'developer',
    aliases: ['github', 'git hub'],
    homeUrl: 'https://github.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search repositories', 'review issues/PRs', 'draft code or comments'],
    sensitiveActions: ['pushing code', 'merging PRs', 'closing issues', 'changing repo settings'],
    requiredTools: [...BROWSER_TOOLS, ...HTTP_TOOLS],
    apiEnvVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
  },
  {
    id: 'microsoft-teams',
    label: 'Microsoft Teams',
    category: 'communications',
    aliases: ['microsoft teams', 'teams', 'teams.microsoft.com'],
    homeUrl: 'https://teams.microsoft.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search chats/channels', 'summarize meetings', 'draft messages after approval'],
    sensitiveActions: ['sending messages', 'joining meetings', 'inviting users', 'changing channel settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REFRESH_TOKEN'],
  },
  {
    id: 'zoom',
    label: 'Zoom',
    category: 'communications',
    aliases: ['zoom', 'zoom.us'],
    homeUrl: 'https://zoom.us/signin',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review meetings', 'summarize recordings', 'draft meeting updates'],
    sensitiveActions: ['starting meetings', 'inviting attendees', 'changing meeting settings', 'deleting recordings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
  },
  {
    id: 'discord',
    label: 'Discord',
    category: 'communications',
    aliases: ['discord', 'discord.com'],
    homeUrl: 'https://discord.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read channels', 'summarize conversations', 'draft replies after approval'],
    sensitiveActions: ['sending messages', 'moderating users', 'changing server settings', 'deleting content'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID'],
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    category: 'storage',
    aliases: ['dropbox', 'drop box'],
    homeUrl: 'https://www.dropbox.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['find files', 'summarize documents', 'organize folders after approval'],
    sensitiveActions: ['deleting files', 'sharing files', 'moving folders', 'changing permissions'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['DROPBOX_ACCESS_TOKEN', 'DROPBOX_REFRESH_TOKEN'],
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    category: 'storage',
    aliases: ['onedrive', 'one drive', 'microsoft drive'],
    homeUrl: 'https://onedrive.live.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['find files', 'summarize documents', 'draft file organization steps'],
    sensitiveActions: ['deleting files', 'sharing files', 'moving folders', 'changing permissions'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REFRESH_TOKEN'],
  },
  {
    id: 'box',
    label: 'Box',
    category: 'storage',
    aliases: ['box', 'box.com'],
    homeUrl: 'https://account.box.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search files', 'summarize documents', 'draft folder changes'],
    sensitiveActions: ['deleting files', 'sharing files', 'moving folders', 'changing permissions'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['BOX_CLIENT_ID', 'BOX_CLIENT_SECRET', 'BOX_ACCESS_TOKEN'],
  },
  {
    id: 'trello',
    label: 'Trello',
    category: 'productivity',
    aliases: ['trello', 'trello board'],
    homeUrl: 'https://trello.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read boards/cards', 'summarize work', 'draft card updates'],
    sensitiveActions: ['creating cards', 'moving cards', 'archiving cards', 'changing board permissions'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['TRELLO_API_KEY', 'TRELLO_TOKEN'],
  },
  {
    id: 'asana',
    label: 'Asana',
    category: 'productivity',
    aliases: ['asana'],
    homeUrl: 'https://app.asana.com/-/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search tasks/projects', 'summarize project status', 'draft task updates'],
    sensitiveActions: ['creating tasks', 'changing due dates', 'assigning users', 'deleting tasks'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['ASANA_ACCESS_TOKEN'],
  },
  {
    id: 'monday',
    label: 'Monday.com',
    category: 'productivity',
    aliases: ['monday', 'monday.com'],
    homeUrl: 'https://auth.monday.com/auth/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['read boards/items', 'summarize statuses', 'draft item updates'],
    sensitiveActions: ['creating items', 'updating statuses', 'deleting items', 'changing automations'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['MONDAY_API_TOKEN'],
  },
  {
    id: 'linear',
    label: 'Linear',
    category: 'developer',
    aliases: ['linear', 'linear.app'],
    homeUrl: 'https://linear.app/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search issues', 'summarize cycles', 'draft issue updates'],
    sensitiveActions: ['changing issue status', 'editing issues', 'deleting issues', 'changing team settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['LINEAR_API_KEY'],
  },
  {
    id: 'zendesk',
    label: 'Zendesk',
    category: 'support',
    aliases: ['zendesk', 'zen desk'],
    homeUrl: 'https://www.zendesk.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search tickets', 'summarize customer issues', 'draft ticket replies'],
    sensitiveActions: ['sending replies', 'changing ticket status', 'deleting tickets', 'editing customer records'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_API_TOKEN'],
  },
  {
    id: 'intercom',
    label: 'Intercom',
    category: 'support',
    aliases: ['intercom'],
    homeUrl: 'https://app.intercom.com/a/apps/_/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search conversations', 'summarize customer context', 'draft support replies'],
    sensitiveActions: ['sending replies', 'closing conversations', 'editing users', 'triggering campaigns'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['INTERCOM_ACCESS_TOKEN'],
  },
  {
    id: 'servicenow',
    label: 'ServiceNow',
    category: 'support',
    aliases: ['servicenow', 'service now'],
    homeUrl: 'https://www.servicenow.com/login.html',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search incidents', 'summarize tickets', 'draft workflow updates'],
    sensitiveActions: ['updating incidents', 'closing tickets', 'changing workflows', 'editing users'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['SERVICENOW_INSTANCE_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD'],
  },
  {
    id: 'stripe',
    label: 'Stripe',
    category: 'finance',
    aliases: ['stripe', 'stripe dashboard'],
    homeUrl: 'https://dashboard.stripe.com/login',
    authModes: ['browser', 'api'],
    capabilities: ['review payments', 'summarize customers/subscriptions', 'draft billing actions'],
    sensitiveActions: ['issuing refunds', 'creating charges', 'changing subscriptions', 'updating payout settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['STRIPE_API_KEY', 'STRIPE_SECRET_KEY'],
  },
  {
    id: 'paypal',
    label: 'PayPal',
    category: 'finance',
    aliases: ['paypal', 'pay pal'],
    homeUrl: 'https://www.paypal.com/signin',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review transactions', 'summarize payments', 'draft customer/payment actions'],
    sensitiveActions: ['sending money', 'issuing refunds', 'changing account settings', 'creating invoices'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  },
  {
    id: 'square',
    label: 'Square',
    category: 'finance',
    aliases: ['square', 'squareup'],
    homeUrl: 'https://squareup.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review sales', 'summarize customers', 'draft catalog/payment actions'],
    sensitiveActions: ['issuing refunds', 'editing catalog items', 'changing payment settings', 'creating invoices'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['SQUARE_ACCESS_TOKEN'],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    category: 'social',
    aliases: ['linkedin', 'linked in'],
    homeUrl: 'https://www.linkedin.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search profiles/posts', 'summarize company pages', 'draft outreach after approval'],
    sensitiveActions: ['sending messages', 'posting content', 'connecting with people', 'editing profile data'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['LINKEDIN_ACCESS_TOKEN'],
  },
  {
    id: 'twitter',
    label: 'X / Twitter',
    category: 'social',
    aliases: ['twitter', 'x.com'],
    homeUrl: 'https://x.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search posts', 'summarize threads', 'draft posts or replies'],
    sensitiveActions: ['posting content', 'replying', 'following accounts', 'deleting posts'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['TWITTER_BEARER_TOKEN', 'X_BEARER_TOKEN'],
  },
  {
    id: 'facebook',
    label: 'Facebook / Meta',
    category: 'social',
    aliases: ['facebook', 'meta', 'facebook.com'],
    homeUrl: 'https://www.facebook.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review pages/groups', 'summarize posts', 'draft social updates'],
    sensitiveActions: ['posting content', 'sending messages', 'changing page settings', 'running ads'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['META_ACCESS_TOKEN', 'FACEBOOK_ACCESS_TOKEN'],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    category: 'social',
    aliases: ['instagram', 'ig', 'instagram.com'],
    homeUrl: 'https://www.instagram.com/accounts/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review posts', 'summarize comments', 'draft captions or replies'],
    sensitiveActions: ['posting content', 'replying to messages', 'deleting posts', 'changing profile settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['INSTAGRAM_ACCESS_TOKEN', 'META_ACCESS_TOKEN'],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    category: 'social',
    aliases: ['tiktok', 'tik tok'],
    homeUrl: 'https://www.tiktok.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review videos', 'summarize comments', 'draft captions or replies'],
    sensitiveActions: ['posting content', 'replying to comments', 'deleting videos', 'changing profile settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_ACCESS_TOKEN'],
  },
  {
    id: 'reddit',
    label: 'Reddit',
    category: 'social',
    aliases: ['reddit', 'reddit.com'],
    homeUrl: 'https://www.reddit.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['search posts', 'summarize threads', 'draft comments or posts'],
    sensitiveActions: ['posting content', 'commenting', 'moderating communities', 'deleting posts'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_REFRESH_TOKEN'],
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    category: 'marketing',
    aliases: ['wordpress', 'word press', 'wp admin'],
    homeUrl: 'https://wordpress.com/log-in',
    authModes: ['browser', 'api'],
    capabilities: ['review posts/pages', 'summarize site content', 'draft article edits'],
    sensitiveActions: ['publishing posts', 'editing pages', 'deleting content', 'changing site settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['WORDPRESS_BASE_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD'],
  },
  {
    id: 'webflow',
    label: 'Webflow',
    category: 'marketing',
    aliases: ['webflow', 'web flow'],
    homeUrl: 'https://webflow.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review site pages', 'summarize CMS items', 'draft content updates'],
    sensitiveActions: ['publishing site changes', 'editing CMS data', 'deleting pages', 'changing site settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['WEBFLOW_API_TOKEN'],
  },
  {
    id: 'mailchimp',
    label: 'Mailchimp',
    category: 'marketing',
    aliases: ['mailchimp', 'mail chimp'],
    homeUrl: 'https://login.mailchimp.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review campaigns', 'summarize audiences', 'draft email content'],
    sensitiveActions: ['sending campaigns', 'editing audiences', 'deleting contacts', 'changing automations'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['MAILCHIMP_API_KEY', 'MAILCHIMP_SERVER_PREFIX'],
  },
  {
    id: 'calendly',
    label: 'Calendly',
    category: 'productivity',
    aliases: ['calendly'],
    homeUrl: 'https://calendly.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review events', 'summarize availability', 'draft scheduling links'],
    sensitiveActions: ['changing availability', 'canceling events', 'editing event types', 'inviting users'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['CALENDLY_ACCESS_TOKEN'],
  },
  {
    id: 'docusign',
    label: 'DocuSign',
    category: 'documents',
    aliases: ['docusign', 'docu sign'],
    homeUrl: 'https://account.docusign.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review envelopes', 'summarize document status', 'draft signature workflows'],
    sensitiveActions: ['sending envelopes', 'voiding envelopes', 'changing recipients', 'editing documents'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_ACCESS_TOKEN'],
  },
  {
    id: 'figma',
    label: 'Figma',
    category: 'design',
    aliases: ['figma'],
    homeUrl: 'https://www.figma.com/login',
    authModes: ['browser', 'api'],
    capabilities: ['review files', 'summarize comments', 'draft design feedback'],
    sensitiveActions: ['editing files', 'deleting files', 'changing permissions', 'publishing libraries'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['FIGMA_TOKEN', 'FIGMA_ACCESS_TOKEN'],
  },
  {
    id: 'canva',
    label: 'Canva',
    category: 'design',
    aliases: ['canva'],
    homeUrl: 'https://www.canva.com/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review designs', 'summarize brand assets', 'draft design edits'],
    sensitiveActions: ['editing designs', 'deleting designs', 'sharing assets', 'publishing content'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET', 'CANVA_ACCESS_TOKEN'],
  },
  {
    id: 'aws',
    label: 'AWS Console',
    category: 'cloud',
    aliases: ['aws', 'amazon web services', 'aws console'],
    homeUrl: 'https://console.aws.amazon.com',
    authModes: ['browser', 'api'],
    capabilities: ['review resources', 'summarize cloud status', 'draft infrastructure actions'],
    sensitiveActions: ['creating resources', 'deleting resources', 'changing IAM/security', 'modifying billing settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE'],
  },
  {
    id: 'azure',
    label: 'Azure Portal',
    category: 'cloud',
    aliases: ['azure', 'azure portal', 'microsoft azure'],
    homeUrl: 'https://portal.azure.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review resources', 'summarize cloud status', 'draft infrastructure actions'],
    sensitiveActions: ['creating resources', 'deleting resources', 'changing IAM/security', 'modifying billing settings'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_SECRET'],
  },
  {
    id: 'google-ads',
    label: 'Google Ads',
    category: 'marketing',
    aliases: ['google ads', 'adwords', 'ads.google.com'],
    homeUrl: 'https://ads.google.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review campaigns', 'summarize spend/performance', 'draft campaign changes'],
    sensitiveActions: ['changing budgets', 'pausing campaigns', 'publishing ads', 'editing targeting'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_REFRESH_TOKEN'],
  },
  {
    id: 'meta-ads',
    label: 'Meta Ads',
    category: 'marketing',
    aliases: ['meta ads', 'facebook ads', 'ads manager'],
    homeUrl: 'https://adsmanager.facebook.com',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review campaigns', 'summarize ad performance', 'draft campaign changes'],
    sensitiveActions: ['changing budgets', 'publishing ads', 'editing targeting', 'pausing campaigns'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['META_ACCESS_TOKEN', 'FACEBOOK_ACCESS_TOKEN'],
  },
  {
    id: 'zapier',
    label: 'Zapier',
    category: 'automation',
    aliases: ['zapier'],
    homeUrl: 'https://zapier.com/app/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review zaps', 'summarize automations', 'draft automation changes'],
    sensitiveActions: ['turning zaps on/off', 'editing automations', 'changing connected accounts', 'deleting workflows'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['ZAPIER_API_KEY', 'ZAPIER_NLA_API_KEY'],
  },
  {
    id: 'make-com',
    label: 'Make',
    category: 'automation',
    aliases: ['make.com', 'integromat'],
    homeUrl: 'https://www.make.com/en/login',
    authModes: ['browser', 'api', 'oauth'],
    capabilities: ['review scenarios', 'summarize automations', 'draft scenario changes'],
    sensitiveActions: ['turning scenarios on/off', 'editing automations', 'changing connected accounts', 'deleting scenarios'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['MAKE_API_TOKEN', 'INTEGROMAT_API_TOKEN'],
  },
  {
    id: 'snowflake',
    label: 'Snowflake',
    category: 'database',
    aliases: ['snowflake', 'snowflake console'],
    homeUrl: 'https://app.snowflake.com',
    authModes: ['browser', 'api'],
    capabilities: ['review worksheets', 'summarize warehouse/account status', 'draft SQL analysis'],
    sensitiveActions: ['running write queries', 'changing warehouses', 'editing roles', 'deleting data'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: ['SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_USERNAME', 'SNOWFLAKE_PASSWORD'],
  },
  {
    id: 'generic-web',
    label: 'External Website',
    category: 'generic',
    aliases: ['external website', 'external websites', 'website', 'websites', 'external account', 'external accounts', 'web app'],
    homeUrl: 'https://www.google.com',
    authModes: ['browser', 'api'],
    capabilities: ['open pages', 'read content', 'click/type/navigate after approval'],
    sensitiveActions: ['submitting forms', 'changing account data', 'making purchases', 'posting content'],
    requiredTools: BROWSER_TOOLS,
    apiEnvVars: [],
  },
]

export const CONNECTOR_INTENT = /\b(connect|link|login|log in|sign in|access|use|integrate|sync|authorize|auth|authenticated|account|connector|connectors)\b/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findConnectorsForText(text: string): ConnectorEntry[] {
  const normalized = text.trim().toLowerCase()
  return CONNECTOR_REGISTRY
    .filter(connector => connector.aliases.some(alias => {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias.toLowerCase())}([^a-z0-9]|$)`, 'i')
      return pattern.test(normalized)
    }))
    .filter((connector, index, connectors) => connectors.findIndex(c => c.id === connector.id) === index)
}

export function buildExternalConnectorAnswer(text: string): string | null {
  if (!CONNECTOR_INTENT.test(text)) return null

  const matches = findConnectorsForText(text)
  if (matches.length === 0) return null

  const services = matches.some(connector => connector.id === 'generic-web') && matches.length === 1
    ? CONNECTOR_REGISTRY.filter(connector => ['salesforce', 'gmail', 'google-sheets', 'youtube'].includes(connector.id))
    : matches.filter(connector => connector.id !== 'generic-web')

  if (services.length === 0) return null

  const serviceList = services
    .map(service => `- ${service.label}: ${service.capabilities.join(', ')}.`)
    .join('\n')
  const sensitiveList = [...new Set(services.flatMap(service => service.sensitiveActions))]
    .slice(0, 5)
    .join(', ')
  const firstService = services[0]

  return [
    `Yes. I can connect with ${services.length === 1 ? firstService.label : 'these connectors'} using the central connector registry.`,
    '',
    'Best path:',
    '1. You sign in normally in Chrome or Edge. Do not paste passwords here.',
    '2. I connect to that authenticated browser session, or use a configured API/OAuth token when available.',
    '3. I can read/navigate/search immediately, and I ask before sensitive changes.',
    '',
    serviceList,
    '',
    `Approval-gated actions include: ${sensitiveList}.`,
    `Next step: open ${firstService.homeUrl}, sign in normally, then I can connect to the browser session and work from there.`,
  ].join('\n')
}

export function getConnectorStatusSnapshot(toolNames: string[], env: NodeJS.ProcessEnv): ConnectorStatusSnapshot {
  const availableTools = new Set(toolNames)
  const connectors = CONNECTOR_REGISTRY.map((connector): ConnectorStatus => {
    const missingTools = connector.requiredTools.filter(tool => !availableTools.has(tool))
    const apiConfigured = connector.apiEnvVars.some(name => Boolean(env[name]))
    const browserSupported = connector.authModes.includes('browser') && missingTools.length === 0
    const status = apiConfigured ? 'api-ready' : browserSupported ? 'browser-ready' : 'setup-needed'
    const detail = apiConfigured
      ? 'API/OAuth environment is configured.'
      : browserSupported
        ? 'Ready through authenticated Chrome/Edge browser session.'
        : `Missing tool support: ${missingTools.join(', ') || 'connector setup'}.`

    return { ...connector, apiConfigured, browserSupported, missingTools, status, detail }
  })

  return {
    checkedAt: Date.now(),
    total: connectors.length,
    apiReady: connectors.filter(connector => connector.status === 'api-ready').length,
    browserReady: connectors.filter(connector => connector.status === 'browser-ready').length,
    setupNeeded: connectors.filter(connector => connector.status === 'setup-needed').length,
    connectors,
  }
}