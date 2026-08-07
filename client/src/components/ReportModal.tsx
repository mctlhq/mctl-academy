import { useState } from "react";
import "./ReportModal.css";

const MAX_COMMENT_LENGTH = 2000;

interface ReportModalProps {
  questionId: string;
  onClose: () => void;
}

export function ReportModal({ questionId, onClose }: ReportModalProps) {
  const [reason, setReason] = useState<string>("typo");
  const [comment, setComment] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: questionId,
          reason,
          comment
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit report");
      }

      setStatus("success");
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Network error");
    }
  };

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Report an issue with this question</h3>
        <p className="report-meta">Question ID: <code>{questionId}</code></p>

        {status === "success" ? (
          <div className="report-status success">
            Thank you! Your feedback has been submitted.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor="report-reason">Reason</label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={status === "submitting"}
            >
              <option value="typo">Typo or formatting error</option>
              <option value="factual_error">Factual or technical inaccuracy</option>
              <option value="unclear_stem">Unclear or ambiguous question stem</option>
              <option value="bad_distractor">Incorrect or ambiguous distractor options</option>
              <option value="other">Other feedback</option>
            </select>

            <label htmlFor="report-comment">Details (optional)</label>
            <textarea
              id="report-comment"
              rows={3}
              placeholder="Describe the issue in detail..."
              value={comment}
              maxLength={MAX_COMMENT_LENGTH}
              onChange={(e) => setComment(e.target.value)}
              disabled={status === "submitting"}
            />
            <p className="report-char-count">
              {comment.length} / {MAX_COMMENT_LENGTH}
            </p>

            {status === "error" && <p className="report-error">{errorMessage}</p>}

            <div className="report-actions">
              <button type="button" className="btn-cancel" onClick={onClose} disabled={status === "submitting"}>
                Cancel
              </button>
              <button type="submit" className="btn-submit" disabled={status === "submitting"}>
                {status === "submitting" ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
