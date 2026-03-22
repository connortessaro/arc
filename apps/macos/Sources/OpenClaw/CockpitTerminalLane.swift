import AppKit
import Observation
import SwiftUI

/// A live terminal output view for a single cockpit worker lane.
/// Polls the gateway for PTY snapshots and auto-scrolls to the bottom.
@MainActor
struct CockpitTerminalLane: View {
    let workerId: String
    let workerName: String
    let status: String
    @Bindable var terminalStore: CockpitTerminalStore

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(self.statusColor)
                    .frame(width: 8, height: 8)
                Text(self.workerName)
                    .font(.caption.weight(.semibold))
                Spacer()
                Text(self.status.replacingOccurrences(of: "_", with: " "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if self.terminalStore.isPolling {
                    ProgressView()
                        .controlSize(.mini)
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)

            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    Text(self.displayText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.primary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .id("terminal-bottom")
                }
                .onChange(of: self.terminalStore.stdoutContent) {
                    if self.terminalStore.autoScroll {
                        proxy.scrollTo("terminal-bottom", anchor: .bottom)
                    }
                }
            }
            .background(Color(nsColor: .textBackgroundColor).opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .padding(.horizontal, 6)
            .padding(.bottom, 6)
        }
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.primary.opacity(0.03))
                .stroke(Color.primary.opacity(0.08), lineWidth: 1))
    }

    private var displayText: String {
        let stdout = self.terminalStore.stdoutContent
        let stderr = self.terminalStore.stderrContent
        if stdout.isEmpty && stderr.isEmpty {
            return "Waiting for output…"
        }
        if stderr.isEmpty { return Self.stripAnsi(stdout) }
        if stdout.isEmpty { return Self.stripAnsi(stderr) }
        return "\(Self.stripAnsi(stdout))\n\nstderr:\n\(Self.stripAnsi(stderr))"
    }

    private var statusColor: Color {
        switch self.status {
        case "running": .green
        case "paused": .orange
        case "failed", "cancelled": .red
        case "completed", "succeeded": .blue
        default: .gray
        }
    }

    /// Strip ANSI escape sequences for display in a plain text view.
    private static func stripAnsi(_ input: String) -> String {
        // Matches CSI sequences (ESC [ ... final byte) and OSC sequences (ESC ] ... ST).
        let pattern = #"\x1B(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1B]*(?:\x07|\x1B\\))"#
        return (try? NSRegularExpression(pattern: pattern))
            .map { $0.stringByReplacingMatches(in: input, range: NSRange(input.startIndex..., in: input), withTemplate: "") }
            ?? input
    }
}

/// Manages polling for a single worker's PTY snapshot.
@MainActor
@Observable
final class CockpitTerminalStore {
    let workerId: String
    var stdoutContent = ""
    var stderrContent = ""
    var isPolling = false
    var autoScroll = true

    private let loadSnapshot: @Sendable (_ workerId: String) async throws -> CockpitPtySnapshot
    private var pollTask: Task<Void, Never>?

    init(
        workerId: String,
        loadSnapshot: @escaping @Sendable (_ workerId: String) async throws -> CockpitPtySnapshot)
    {
        self.workerId = workerId
        self.loadSnapshot = loadSnapshot
    }

    func startPolling(intervalSeconds: Double = 1.5) {
        guard self.pollTask == nil else { return }
        self.pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.isPolling = true
                do {
                    let snapshot = try await self.loadSnapshot(self.workerId)
                    self.stdoutContent = snapshot.stdoutTail
                    self.stderrContent = snapshot.stderrTail
                } catch {
                    // Polling errors are silently tolerated; next poll will retry.
                }
                self.isPolling = false
                try? await Task.sleep(for: .seconds(intervalSeconds))
            }
        }
    }

    func stopPolling() {
        self.pollTask?.cancel()
        self.pollTask = nil
        self.isPolling = false
    }
}
