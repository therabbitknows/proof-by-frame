class SubmissionState:
    CREATED           = "created"
    FRONT_ANALYZED    = "front_analyzed"
    BACK_ANALYZED     = "back_analyzed"
    NOTES_SUBMITTED   = "notes_submitted"
    PREGRADE_READY    = "pregrade_ready"
    COMMUNITY_VOTING  = "community_voting"
    REVIEW_COMPLETE   = "review_complete"
    SEALED            = "sealed"
    SEAL_FAILED       = "seal_failed"
    VOTING_REOPENED   = "voting_reopened"
    PROOF_PENDING     = "proof_pending"
    PROOF_RECEIVED    = "proof_received"

    # States where voting is active (buttons should accept clicks)
    VOTING_ACTIVE_STATES = frozenset({"community_voting", "voting_reopened"})


VALID_TRANSITIONS = {
    SubmissionState.CREATED:          [SubmissionState.FRONT_ANALYZED],
    SubmissionState.FRONT_ANALYZED:   [SubmissionState.BACK_ANALYZED],
    SubmissionState.BACK_ANALYZED:    [SubmissionState.NOTES_SUBMITTED],
    SubmissionState.NOTES_SUBMITTED:  [SubmissionState.PREGRADE_READY, SubmissionState.COMMUNITY_VOTING],
    SubmissionState.PREGRADE_READY:   [SubmissionState.COMMUNITY_VOTING],
    SubmissionState.COMMUNITY_VOTING: [SubmissionState.REVIEW_COMPLETE],
    SubmissionState.REVIEW_COMPLETE:  [SubmissionState.SEALED, SubmissionState.SEAL_FAILED],
    SubmissionState.SEALED:           [SubmissionState.PROOF_PENDING, SubmissionState.VOTING_REOPENED],
    SubmissionState.SEAL_FAILED:      [SubmissionState.SEALED, SubmissionState.VOTING_REOPENED],
    SubmissionState.VOTING_REOPENED:  [SubmissionState.REVIEW_COMPLETE],
    SubmissionState.PROOF_PENDING:    [SubmissionState.PROOF_RECEIVED],
    SubmissionState.PROOF_RECEIVED:   [],
}


def can_transition(current: str, target: str) -> bool:
    return target in VALID_TRANSITIONS.get(current, [])


NEXT_STEP_PROMPTS = {
    SubmissionState.CREATED:
        "📸 Next: `/add-front` — upload your front image",
    SubmissionState.FRONT_ANALYZED:
        "🔄 Next: `/add-back` — upload your back image",
    SubmissionState.BACK_ANALYZED:
        "📋 Next: `/notes` — submit physical inspection",
    SubmissionState.NOTES_SUBMITTED:
        "📊 Optional: `/baselines` — add known grades\n"
        "✅ Or: `/ready` — open community voting",
    SubmissionState.PREGRADE_READY:
        "🗳️ Voting is open. Use the buttons below.",
    SubmissionState.REVIEW_COMPLETE:
        "🔒 Threshold met. Auto-sealing…",
    SubmissionState.SEALED:
        "📬 Sent to grading? Run `/proof-pending`",
    SubmissionState.SEAL_FAILED:
        "⚠️ Auto-seal failed. Admin: check logs or run `/seal` to retry.",
    SubmissionState.VOTING_REOPENED:
        "🔄 Voting reopened with escalated threshold. Vote again below.",
    SubmissionState.PROOF_PENDING:
        "📬 Grade back? Run `/proof-result`",
}


def get_next_prompt(state: str) -> str:
    return NEXT_STEP_PROMPTS.get(state, "")
