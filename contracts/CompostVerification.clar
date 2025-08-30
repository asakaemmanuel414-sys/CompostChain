;; CompostVerification.clar
;; Core contract for verifying compost quality and completion in CompostChain.
;; Integrates with oracles, ensures immutability, and triggers credit issuance.
;; Features: multi-stage verification, auditor roles, disputes, metadata, history, oracle callbacks.

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-BATCH u101)
(define-constant ERR-ALREADY-VERIFIED u102)
(define-constant ERR-QUALITY-FAIL u103)
(define-constant ERR-PAUSED u104)
(define-constant ERR-INVALID-ORACLE u105)
(define-constant ERR-DISPUTE-ACTIVE u106)
(define-constant ERR-INVALID-METADATA u107)
(define-constant ERR-EXPIRED u108)
(define-constant ERR-INVALID-ROLE u109)
(define-constant ERR-MAX-HISTORY-EXCEEDED u110)

(define-constant MAX-METADATA-LEN u500)
(define-constant MAX-HISTORY-ENTRIES u20)
(define-constant VERIFICATION_EXPIRY u1440) ;; ~10 days in blocks
(define-constant QUALITY_THRESHOLD u80) ;; 80% quality score minimum

;; Data Maps
(define-map compost-verifications
  { batch-id: (buff 32) }
  {
    verifier: principal,
    timestamp: uint,
    quality-score: uint,
    metadata: (string-utf8 500),
    status: (string-ascii 20),
    oracle-data: (optional (buff 256)),
    expiry: uint
  }
)

(define-map verification-history
  { batch-id: (buff 32), entry-id: uint }
  {
    actor: principal,
    action: (string-ascii 50),
    timestamp: uint,
    notes: (string-utf8 200)
  }
)

(define-map auditors
  { auditor: principal }
  {
    active: bool,
    added-by: principal,
    added-at: uint,
    verification-count: uint
  }
)

(define-map disputes
  { batch-id: (buff 32) }
  {
    disputer: principal,
    reason: (string-utf8 300),
    timestamp: uint,
    resolved: bool,
    resolver: (optional principal),
    resolution-notes: (optional (string-utf8 300))
  }
)

(define-map oracles
  { oracle: principal }
  { trusted: bool }
)

(define-map batch-history-counter
  { batch-id: (buff 32) }
  { count: uint }
)

;; Global Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var total-verifications uint u0)
(define-data-var oracle-callback-fee uint u100)

;; Trait Definitions
(define-trait processing-trait
  (
    (get-batch-status ((buff 32)) (response (string-ascii 20) uint))
    (update-batch-status ((buff 32) (string-ascii 20)) (response bool uint))
  )
)

(define-trait credit-trait
  (
    (issue-credits ((buff 32) uint principal) (response bool uint))
  )
)

;; Private Functions
(define-private (is-owner (caller principal))
  (is-eq caller (var-get contract-owner))
)

(define-private (is-auditor (caller principal))
  (match (map-get? auditors { auditor: caller })
    entry (get active entry)
    false
  )
)

(define-private (is-trusted-oracle (oracle principal))
  (match (map-get? oracles { oracle: oracle })
    entry (get trusted entry)
    false
  )
)

(define-private (add-history-entry (batch-id (buff 32)) (action (string-ascii 50)) (notes (string-utf8 200)))
  (let
    (
      (counter (default-to u0 (get count (map-get? batch-history-counter { batch-id: batch-id }))))
      (new-counter (+ counter u1))
    )
    (if (> new-counter MAX-HISTORY-ENTRIES)
      (err ERR-MAX-HISTORY-EXCEEDED)
      (begin
        (map-set verification-history
          { batch-id: batch-id, entry-id: new-counter }
          {
            actor: tx-sender,
            action: action,
            timestamp: block-height,
            notes: notes
          }
        )
        (map-set batch-history-counter { batch-id: batch-id } { count: new-counter })
        (ok true)
      )
    )
  )
)

(define-private (calculate-quality-bonus (score uint))
  (if (> score u90)
    u20
    (if (> score u85) u10 u0)
  )
)

;; Public Functions
(define-public (add-auditor (new-auditor principal))
  (if (is-owner tx-sender)
    (begin
      (map-set auditors
        { auditor: new-auditor }
        { active: true, added-by: tx-sender, added-at: block-height, verification-count: u0 }
      )
      (print { event: "auditor-added", auditor: new-auditor })
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (remove-auditor (auditor principal))
  (if (is-owner tx-sender)
    (match (map-get? auditors { auditor: auditor })
      entry
      (begin
        (map-set auditors { auditor: auditor } (merge entry { active: false }))
        (print { event: "auditor-removed", auditor: auditor })
        (ok true)
      )
      (err ERR-INVALID-ROLE)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (add-trusted-oracle (oracle principal))
  (if (is-owner tx-sender)
    (begin
      (map-set oracles { oracle: oracle } { trusted: true })
      (print { event: "oracle-added", oracle: oracle })
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (remove-trusted-oracle (oracle principal))
  (if (is-owner tx-sender)
    (begin
      (map-set oracles { oracle: oracle } { trusted: false })
      (print { event: "oracle-removed", oracle: oracle })
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (verify-compost (batch-id (buff 32)) (quality-score uint) (metadata (string-utf8 500)) (processing-contract <processing-trait>))
  (if (var-get paused)
    (err ERR-PAUSED)
    (if (is-auditor tx-sender)
      (match (contract-call? processing-contract get-batch-status batch-id)
        success-status
        (if (is-eq success-status "processed")
          (match (map-get? compost-verifications { batch-id: batch-id })
            existing
            (err ERR-ALREADY-VERIFIED)
            (if (> (len metadata) MAX-METADATA-LEN)
              (err ERR-INVALID-METADATA)
              (if (< quality-score QUALITY_THRESHOLD)
                (begin
                  (map-set compost-verifications
                    { batch-id: batch-id }
                    {
                      verifier: tx-sender,
                      timestamp: block-height,
                      quality-score: quality-score,
                      metadata: metadata,
                      status: "rejected",
                      oracle-data: none,
                      expiry: (+ block-height VERIFICATION_EXPIRY)
                    }
                  )
                  (try! (add-history-entry batch-id "rejected" "Quality below threshold"))
                  (print { event: "compost-rejected", batch-id: batch-id, score: quality-score })
                  (ok false)
                )
                (begin
                  (map-set compost-verifications
                    { batch-id: batch-id }
                    {
                      verifier: tx-sender,
                      timestamp: block-height,
                      quality-score: quality-score,
                      metadata: metadata,
                      status: "verified",
                      oracle-data: none,
                      expiry: (+ block-height VERIFICATION_EXPIRY)
                    }
                  )
                  (try! (add-history-entry batch-id "verified" (concat "Score: " (int-to-utf8 quality-score))))
                  (try! (contract-call? processing-contract update-batch-status batch-id "verified"))
                  (var-set total-verifications (+ (var-get total-verifications) u1))
                  (print { event: "compost-verified", batch-id: batch-id, score: quality-score })
                  (ok true)
                )
              )
            )
          )
          (err ERR-INVALID-BATCH)
        )
        error (err error)
      )
      (err ERR-UNAUTHORIZED)
    )
  )
)

(define-public (oracle-callback (batch-id (buff 32)) (oracle-data (buff 256)) (quality-score uint))
  (if (is-trusted-oracle tx-sender)
    (match (map-get? compost-verifications { batch-id: batch-id })
      entry
      (if (is-eq (get status entry) "pending")
        (if (< quality-score QUALITY_THRESHOLD)
          (begin
            (map-set compost-verifications { batch-id: batch-id } (merge entry { status: "rejected", oracle-data: (some oracle-data), quality-score: quality-score }))
            (try! (add-history-entry batch-id "oracle-rejected" "Automated quality check failed"))
            (print { event: "oracle-rejected", batch-id: batch-id })
            (ok false)
          )
          (begin
            (map-set compost-verifications { batch-id: batch-id } (merge entry { status: "verified", oracle-data: (some oracle-data), quality-score: quality-score }))
            (try! (add-history-entry batch-id "oracle-verified" "Automated verification successful"))
            (print { event: "oracle-verified", batch-id: batch-id })
            (ok true)
          )
        )
        (err ERR-ALREADY-VERIFIED)
      )
      (err ERR-INVALID-BATCH)
    )
    (err ERR-INVALID-ORACLE)
  )
)

(define-public (initiate-dispute (batch-id (buff 32)) (reason (string-utf8 300)))
  (match (map-get? compost-verifications { batch-id: batch-id })
    entry
    (if (is-eq (get status entry) "verified")
      (if (is-none (map-get? disputes { batch-id: batch-id }))
        (begin
          (map-set disputes
            { batch-id: batch-id }
            {
              disputer: tx-sender,
              reason: reason,
              timestamp: block-height,
              resolved: false,
              resolver: none,
              resolution-notes: none
            }
          )
          (map-set compost-verifications { batch-id: batch-id } (merge entry { status: "disputed" }))
          (try! (add-history-entry batch-id "dispute-initiated" reason))
          (print { event: "dispute-initiated", batch-id: batch-id, disputer: tx-sender })
          (ok true)
        )
        (err ERR-DISPUTE-ACTIVE)
      )
      (err ERR-INVALID-BATCH)
    )
    (err ERR-INVALID-BATCH)
  )
)

(define-public (resolve-dispute (batch-id (buff 32)) (resolve-to-verified bool) (notes (string-utf8 300)))
  (if (is-owner tx-sender)
    (match (map-get? disputes { batch-id: batch-id })
      dispute
      (if (not (get resolved dispute))
        (match (map-get? compost-verifications { batch-id: batch-id })
          entry
          (begin
            (map-set disputes { batch-id: batch-id } (merge dispute { resolved: true, resolver: (some tx-sender), resolution-notes: (some notes) }))
            (map-set compost-verifications { batch-id: batch-id } (merge entry { status: (if resolve-to-verified "verified" "rejected") }))
            (try! (add-history-entry batch-id (if resolve-to-verified "dispute-resolved-verified" "dispute-resolved-rejected") notes))
            (print { event: "dispute-resolved", batch-id: batch-id, resolved-to: (if resolve-to-verified "verified" "rejected") })
            (ok true)
          )
          (err ERR-INVALID-BATCH)
        )
        (err ERR-INVALID-BATCH)
      )
      (err ERR-INVALID-BATCH)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (trigger-credit-issuance (batch-id (buff 32)) (credit-contract <credit-trait>))
  (match (map-get? compost-verifications { batch-id: batch-id })
    entry
    (if (and (is-eq (get status entry) "verified") (< block-height (get expiry entry)))
      (let
        (
          (score (get quality-score entry))
          (bonus (calculate-quality-bonus score))
          (credits (+ score bonus))
        )
        (try! (contract-call? credit-contract issue-credits batch-id credits tx-sender))
        (try! (add-history-entry batch-id "credits-issued" (concat "Credits: " (int-to-utf8 credits))))
        (print { event: "credits-triggered", batch-id: batch-id, amount: credits })
        (ok true)
      )
      (err ERR-INVALID-BATCH)
    )
    (err ERR-INVALID-BATCH)
  )
)

(define-public (pause-contract)
  (if (is-owner tx-sender)
    (begin
      (var-set paused true)
      (print { event: "contract-paused" })
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (unpause-contract)
  (if (is-owner tx-sender)
    (begin
      (var-set paused false)
      (print { event: "contract-unpaused" })
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-oracle-fee (new-fee uint))
  (if (is-owner tx-sender)
    (begin
      (var-set oracle-callback-fee new-fee)
      (print { event: "oracle-fee-updated", fee: new-fee })
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

;; Read-Only Functions
(define-read-only (get-verification-details (batch-id (buff 32)))
  (map-get? compost-verifications { batch-id: batch-id })
)

(define-read-only (get-history-entry (batch-id (buff 32)) (entry-id uint))
  (map-get? verification-history { batch-id: batch-id, entry-id: entry-id })
)

(define-read-only (get-history-count (batch-id (buff 32)))
  (default-to u0 (get count (map-get? batch-history-counter { batch-id: batch-id })))
)

(define-read-only (is-batch-verified (batch-id (buff 32)))
  (match (map-get? compost-verifications { batch-id: batch-id })
    entry (is-eq (get status entry) "verified")
    false
  )
)

(define-read-only (get-dispute-details (batch-id (buff 32)))
  (map-get? disputes { batch-id: batch-id })
)

(define-read-only (get-total-verifications)
  (var-get total-verifications)
)

(define-read-only (get-auditor-info (auditor principal))
  (map-get? auditors { auditor: auditor })
)

(define-read-only (get-oracle-status (oracle principal))
  (map-get? oracles { oracle: oracle })
)

(define-read-only (get-contract-paused)
  (var-get paused)
)

(define-read-only (get-oracle-fee)
  (var-get oracle-callback-fee)
)