import SwiftUI

// MARK: - Run status helpers

enum RunStatusCategory: String, CaseIterable, Identifiable {
    case all = "All"
    case succeeded = "Succeeded"
    case failed = "Failed"
    case cancelled = "Cancelled"

    var id: String { self.rawValue }

    func matches(_ status: String) -> Bool {
        switch self {
        case .all: true
        case .succeeded: status == "succeeded"
        case .failed: status == "failed"
        case .cancelled: status == "cancelled"
        }
    }
}

private extension CockpitRunSummary {
    var isFinished: Bool {
        self.status == "succeeded" || self.status == "failed" || self.status == "cancelled"
    }

    var statusColor: Color {
        switch self.status {
        case "succeeded": .green
        case "failed": .red
        case "cancelled": .orange
        default: .secondary
        }
    }

    var statusIcon: String {
        switch self.status {
        case "succeeded": "checkmark.circle.fill"
        case "failed": "xmark.circle.fill"
        case "cancelled": "minus.circle.fill"
        default: "circle"
        }
    }

    var durationText: String? {
        guard let startedAt, let finishedAt else { return nil }
        let iso = ISO8601DateFormatter()
        guard let start = iso.date(from: startedAt),
              let end = iso.date(from: finishedAt)
        else { return nil }
        let seconds = Int(end.timeIntervalSince(start))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        let remainder = seconds % 60
        if minutes < 60 { return "\(minutes)m \(remainder)s" }
        let hours = minutes / 60
        return "\(hours)h \(minutes % 60)m"
    }

    var finishedDate: Date? {
        guard let finishedAt else { return nil }
        return ISO8601DateFormatter().date(from: finishedAt)
    }
}

// MARK: - Review queue section (embedded in cockpit)

struct CockpitReviewQueueSection: View {
    let runs: [CockpitRunSummary]
    @State private var filter: RunStatusCategory = .all
    @State private var selectedRun: CockpitRunSummary?

    private var finishedRuns: [CockpitRunSummary] {
        let finished = self.runs.filter(\.isFinished)
        if self.filter == .all { return finished }
        return finished.filter { self.filter.matches($0.status) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Review Queue")
                    .font(.title3.weight(.semibold))
                Spacer()
                Picker("Filter", selection: self.$filter) {
                    ForEach(RunStatusCategory.allCases) { category in
                        Text(category.rawValue).tag(category)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 320)
            }

            if self.finishedRuns.isEmpty {
                reviewQueuePlaceholder
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    reviewQueueHeader
                    Divider()
                    ForEach(self.finishedRuns) { run in
                        Button {
                            self.selectedRun = run
                        } label: {
                            CockpitReviewQueueRow(run: run)
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.primary.opacity(0.04)))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(item: self.$selectedRun) { run in
            CockpitRunDetailSheet(run: run)
        }
    }

    private var reviewQueuePlaceholder: some View {
        Text(self.filter == .all
            ? "No finished runs to review."
            : "No \(self.filter.rawValue.lowercased()) runs.")
            .font(.callout)
            .foregroundStyle(.secondary)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.primary.opacity(0.04)))
    }

    private var reviewQueueHeader: some View {
        HStack(spacing: 0) {
            Text("Status")
                .frame(width: 90, alignment: .leading)
            Text("Worker")
                .frame(width: 140, alignment: .leading)
            Text("Summary")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Duration")
                .frame(width: 80, alignment: .trailing)
            Text("Finished")
                .frame(width: 100, alignment: .trailing)
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }
}

// MARK: - Row

private struct CockpitReviewQueueRow: View {
    let run: CockpitRunSummary

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 4) {
                Image(systemName: self.run.statusIcon)
                    .foregroundStyle(self.run.statusColor)
                    .font(.caption)
                Text(self.run.status)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(self.run.statusColor)
            }
            .frame(width: 90, alignment: .leading)

            Text(self.run.workerId ?? "—")
                .font(.caption.monospaced())
                .lineLimit(1)
                .frame(width: 140, alignment: .leading)

            Text(self.run.summary ?? "—")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(self.run.durationText ?? "—")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .frame(width: 80, alignment: .trailing)

            Text(relativeAge(from: self.run.finishedDate))
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 100, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .background(Color.clear)
    }
}

// MARK: - Detail sheet

struct CockpitRunDetailSheet: View {
    let run: CockpitRunSummary
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: self.run.statusIcon)
                    .font(.title2)
                    .foregroundStyle(self.run.statusColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Run \(self.run.id)")
                        .font(.headline.monospaced())
                    Text(self.run.status.replacingOccurrences(of: "_", with: " "))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(self.run.statusColor)
                }
                Spacer()
                Button("Done") { self.dismiss() }
                    .keyboardShortcut(.defaultAction)
            }

            if let summary = self.run.summary, !summary.isEmpty {
                GroupBox("Summary") {
                    Text(summary)
                        .font(.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }

            GroupBox("Details") {
                VStack(alignment: .leading, spacing: 8) {
                    if let taskId = self.run.taskId {
                        detailRow("Task", taskId)
                    }
                    if let workerId = self.run.workerId {
                        detailRow("Worker", workerId)
                    }
                    if let backendId = self.run.backendId {
                        detailRow("Backend", backendId)
                    }
                    if let threadId = self.run.threadId {
                        detailRow("Thread", threadId)
                    }
                    if let startedAt = self.run.startedAt {
                        detailRow("Started", self.formatTimestamp(startedAt))
                    }
                    if let finishedAt = self.run.finishedAt {
                        detailRow("Finished", self.formatTimestamp(finishedAt))
                    }
                    if let duration = self.run.durationText {
                        detailRow("Duration", duration)
                    }
                    if let reason = self.run.terminationReason, !reason.isEmpty {
                        detailRow("Termination Reason", reason)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(24)
        .frame(minWidth: 480, idealWidth: 540, minHeight: 300)
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 120, alignment: .trailing)
            Text(value)
                .font(.caption.monospaced())
                .textSelection(.enabled)
        }
    }

    private func formatTimestamp(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .medium
        return formatter.string(from: date)
    }
}

// MARK: - Previews

#Preview("Review Queue") {
    CockpitReviewQueueSection(runs: CockpitWorkspaceSummary.preview.recentRuns)
        .padding()
        .frame(width: 900)
}
