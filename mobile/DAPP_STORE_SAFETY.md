# Solana dApp Store safety surface

The `Privacy & Safety` screen implements the mobile side of the current Solana
Mobile Publisher Policy requirements:

- first-party privacy policy and community-terms links;
- versioned terms acceptance before a new submission;
- private content reporting by submission ID;
- blocking a submission owner without exposing that owner's identifier; and
- authenticated account/data-deletion requests.

Demo Mode stores terms acceptance locally. Discord-authenticated sessions also
record the acceptance and safety requests through FRAME Brain. This screen does
not change submission state, voting, Discord threads, Blinks, sealing, or credit
behavior.
