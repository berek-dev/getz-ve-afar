export interface Env {
  DB: D1Database;
  /** e.g. "my-team.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Application Audience (AUD) tag of the Access application */
  ACCESS_AUD?: string;
  /** "true" only in local dev (.dev.vars). Never set in production. */
  DEV_BYPASS_AUTH?: string;
}
