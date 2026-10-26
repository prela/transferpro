import { enableOfficeClaimFixture } from './office-claim-fixture'

// Loaded only by vitest.rls.config.ts. A direct vitest run of one RLS file
// without that config does not get the flag, and neither does the e2e server.
enableOfficeClaimFixture()
