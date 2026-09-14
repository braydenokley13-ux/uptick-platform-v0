// Safe for client bundles: no database, credentials or messaging provider imports.
export const MEMBERSHIP_TERMS =
  "Uptick Local is a free local membership for adults age 18 or older. Joining does not require promotional text-message consent or a purchase.";

export const MARKETING_SMS_DISCLOSURE =
  "Optional: I agree to recurring automated promotional texts from Uptick Local about my weekly Uptick, usually one featured message per week. Consent is not required to join or buy anything. Message and data rates may apply. Reply STOP to stop promotional texts or HELP for help. Participating stores do not receive permission to market to me. See Uptick’s SMS Terms, Privacy Policy, and Terms.";

// Compatibility name used by older server modules. Its purpose is promotional SMS.
export const MEMBERSHIP_DISCLOSURE = MARKETING_SMS_DISCLOSURE;
