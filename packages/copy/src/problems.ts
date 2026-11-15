// The page the REST API's error answers point to, https://desk.partnerstandard.com/problems/<code> (question 26):
// each code, its HTTP status, what happened and what to do. The app's own words, code under AGPL 3.0 only.
export const API_PROBLEMS = {
  title: 'API errors',
  description: 'What each error code of the PartnerStandard Desk API means, and what to do.',
  intro: 'When the PartnerStandard Desk API refuses a request, its answer names one of these codes in `code`, and this page in `type`. `title` says what happened in a sentence. The list of addresses is at `/api/v1/openapi.json`.',
  /** Before each entry's text: its HTTP status. */
  status: (status: number, also?: string) => `Status ${status}${also ? `, ${also}` : ''}.`,
  entries: [
    { code: 'invalid', status: 422, also: 'or 400 when the body is not JSON', text: 'The input is not valid. `fieldErrors` names each field that is wrong. Correct it and send it again.' },
    { code: 'unauthorized', status: 401, text: 'No API key or app sign-in came with the request, or it was turned off. Send a key that is still on, or connect the app again.' },
    { code: 'forbidden', status: 403, text: 'The key or app may not do this. It may only read, or this is a decision that a person makes.' },
    { code: 'not_found', status: 404, text: 'There is no such partner, market, program, business case, MAP, review or webhook.' },
    { code: 'file_not_found', status: 404, text: 'The file that holds this work is gone or in the trash. The person opens PartnerStandard Desk to see what to do.' },
    { code: 'not_found_route', status: 404, text: 'There is nothing at this address. The list of addresses is at `/api/v1/openapi.json`.' },
    { code: 'conflict', status: 409, text: 'Someone changed this since you read it. Read it again, then send your change again.' },
    { code: 'structure', status: 409, text: 'The file’s sheets were changed by hand, so it can’t be read. The person opens PartnerStandard Desk to see which file.' },
    { code: 'old_version', status: 409, text: 'The Partners file is from an earlier format. The person opens PartnerStandard Desk to replace it.' },
    { code: 'too_large', status: 413, text: 'The request is over 256 KB. Send less.' },
    { code: 'auth', status: 424, text: 'The person must open PartnerStandard Desk and connect Google again.' },
    { code: 'rate_limited', status: 429, text: 'More than 60 requests this minute. `Retry-After` says how many seconds to wait.' },
    { code: 'unavailable', status: 503, text: 'PartnerStandard Desk or Google couldn’t do it just now. Try again in a minute.' },
    { code: 'quota', status: 507, text: 'The person’s Google Drive is full. They free some space, then you try again.' },
  ] as ReadonlyArray<{ code: string; status: number; also?: string; text: string }>,
};
