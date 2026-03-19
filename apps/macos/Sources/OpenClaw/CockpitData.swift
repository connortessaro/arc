import Foundation

enum CockpitWorkerAction: String, CaseIterable, Codable, Sendable, Equatable, Identifiable {
    case start
    case pause
    case resume
    case cancel

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .start: "Start"
        case .pause: "Pause"
        case .resume: "Resume"
        case .cancel: "Cancel"
        }
    }

    var systemImage: String {
        switch self {
        case .start: "play.fill"
        case .pause: "pause.fill"
        case .resume: "playpause.fill"
        case .cancel: "xmark.circle.fill"
        }
    }
}

enum CockpitGatewayMode: String, Codable, Sendable, Equatable {
    case local
    case remote
    case unconfigured
}

enum CockpitGatewayConnectionState: String, Codable, Sendable, Equatable {
    case ready
    case connecting
    case unavailable
}

struct CockpitGatewayStatus: Codable, Sendable, Equatable {
    let mode: CockpitGatewayMode
    let state: CockpitGatewayConnectionState
    let endpointLabel: String?
    let detail: String?

    var isRemote: Bool {
        self.mode == .remote
    }

    var headline: String {
        switch (self.mode, self.state) {
        case (.remote, .ready):
            "Remote workers active"
        case (.remote, .connecting):
            "Connecting to remote gateway"
        case (.remote, .unavailable):
            "Remote gateway unavailable"
        case (.local, .ready):
            "Local gateway active"
        case (.local, .connecting):
            "Connecting to local gateway"
        case (.local, .unavailable):
            "Local gateway unavailable"
        case (.unconfigured, _):
            "Gateway not configured"
        }
    }

    var detailText: String {
        if let detail, !detail.isEmpty {
            return detail
        }
        switch (self.mode, self.state) {
        case (.remote, .ready):
            if let endpointLabel, !endpointLabel.isEmpty {
                return "Workers are running through \(endpointLabel). This keeps execution and RAM pressure off your Mac."
            }
            return "Workers are running off this Mac through the remote gateway."
        case (.remote, .connecting):
            return "Cockpit is waiting for the remote gateway or tunnel so worker execution can stay off-machine."
        case (.remote, .unavailable):
            return "Reconnect the remote gateway to keep worker execution off your Mac."
        case (.local, .ready):
            return "Workers are running on this Mac. Switch to Remote mode to offload the runtime and reduce RAM usage."
        case (.local, .connecting):
            return "Cockpit is waiting for the local gateway."
        case (.local, .unavailable):
            return "Start or reconnect the local gateway before running workers."
        case (.unconfigured, _):
            return "Configure a local or remote gateway before using Cockpit."
        }
    }
}

struct CockpitTotals: Codable, Sendable {
    let tasks: Int
    let workers: Int
    let reviews: Int
    let decisions: Int
    let contextSnapshots: Int
    let runs: Int
}

struct CockpitTaskSummary: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String
    let priority: String?
    let repoRoot: String?
    let updatedAt: String
}

struct CockpitWorkerSummary: Codable, Identifiable, Sendable {
    let id: String
    let taskId: String
    let name: String
    let status: String
    let lane: String
    let repoRoot: String?
    let worktreePath: String?
    let branch: String?
    let backendId: String?
    let activeRunId: String?
    let updatedAt: String
}

struct CockpitReviewSummary: Codable, Identifiable, Sendable {
    let id: String
    let taskId: String
    let workerId: String?
    let title: String
    let status: String
    let summary: String?
    let updatedAt: String
}

struct CockpitRunSummary: Codable, Identifiable, Sendable {
    let id: String
    let taskId: String?
    let workerId: String?
    let status: String
    let summary: String?
    let backendId: String?
    let threadId: String?
    let startedAt: String?
    let finishedAt: String?
    let terminationReason: String?
    let updatedAt: String
}

struct CockpitLaneSummary: Codable, Identifiable, Sendable {
    let taskId: String
    let taskTitle: String
    let workerId: String
    let workerName: String
    let lane: String
    let status: String
    let repoRoot: String?
    let worktreePath: String?
    let branch: String?
    let objective: String?
    let backendId: String?
    let activeRunId: String?
    let updatedAt: String
    let latestRun: CockpitRunSummary?
    let pendingReview: CockpitReviewSummary?

    var id: String { self.workerId }

    var availableWorkerActions: [CockpitWorkerAction] {
        switch self.status {
        case "queued", "failed", "cancelled", "awaiting_review":
            [.start]
        case "running":
            [.pause, .cancel]
        case "awaiting_approval":
            [.cancel]
        case "paused":
            [.resume, .cancel]
        case "completed":
            []
        default:
            []
        }
    }
}

struct CockpitWorkerLogs: Codable, Sendable {
    let workerId: String
    let latestRun: CockpitRunSummary?
    let stdoutTail: String
    let stderrTail: String
}

struct CockpitWorkspaceSummary: Codable, Sendable {
    let storePath: String
    let generatedAt: String
    let totals: CockpitTotals
    let taskStatusCounts: [String: Int]
    let workerStatusCounts: [String: Int]
    let reviewStatusCounts: [String: Int]
    let recentTasks: [CockpitTaskSummary]
    let recentWorkers: [CockpitWorkerSummary]
    let pendingReviews: [CockpitReviewSummary]
    let recentRuns: [CockpitRunSummary]
    let activeLanes: [CockpitLaneSummary]
}

extension CockpitGatewayStatus {
    static let previewLocal = CockpitGatewayStatus(
        mode: .local,
        state: .ready,
        endpointLabel: "127.0.0.1:18789",
        detail: nil)

    static func from(endpointState: GatewayEndpointState) -> CockpitGatewayStatus {
        switch endpointState {
        case let .ready(mode, url, _, _):
            return CockpitGatewayStatus(
                mode: Self.mode(from: mode),
                state: .ready,
                endpointLabel: Self.endpointLabel(from: url),
                detail: nil)
        case let .connecting(mode, detail):
            return CockpitGatewayStatus(
                mode: Self.mode(from: mode),
                state: .connecting,
                endpointLabel: nil,
                detail: detail)
        case let .unavailable(mode, reason):
            return CockpitGatewayStatus(
                mode: Self.mode(from: mode),
                state: .unavailable,
                endpointLabel: nil,
                detail: reason)
        }
    }

    private static func mode(from mode: AppState.ConnectionMode) -> CockpitGatewayMode {
        switch mode {
        case .local:
            .local
        case .remote:
            .remote
        case .unconfigured:
            .unconfigured
        }
    }

    private static func endpointLabel(from url: URL) -> String {
        let host = url.host ?? url.absoluteString
        if let port = url.port {
            return "\(host):\(port)"
        }
        return host
    }
}

extension CockpitWorkspaceSummary {
    static let preview = CockpitWorkspaceSummary(
        storePath: "/Users/tessaro/.openclaw/code/cockpit.json",
        generatedAt: "2026-03-19T13:00:00.000Z",
        totals: CockpitTotals(
            tasks: 3,
            workers: 4,
            reviews: 2,
            decisions: 5,
            contextSnapshots: 3,
            runs: 7),
        taskStatusCounts: [
            "queued": 0,
            "planning": 1,
            "in_progress": 2,
            "review": 0,
            "blocked": 0,
            "done": 0,
            "cancelled": 0,
        ],
        workerStatusCounts: [
            "queued": 0,
            "running": 2,
            "awaiting_review": 1,
            "awaiting_approval": 0,
            "paused": 1,
            "completed": 0,
            "failed": 0,
            "cancelled": 0,
        ],
        reviewStatusCounts: [
            "pending": 2,
            "approved": 0,
            "changes_requested": 0,
            "dismissed": 0,
        ],
        recentTasks: [
            CockpitTaskSummary(
                id: "task_shell",
                title: "Ship the cockpit shell",
                status: "in_progress",
                priority: "high",
                repoRoot: "/Users/tessaro/openclaw",
                updatedAt: "2026-03-19T12:58:00.000Z"),
            CockpitTaskSummary(
                id: "task_review",
                title: "Tighten review lane",
                status: "planning",
                priority: "normal",
                repoRoot: "/Users/tessaro/openclaw",
                updatedAt: "2026-03-19T12:54:00.000Z"),
        ],
        recentWorkers: [
            CockpitWorkerSummary(
                id: "worker_shell",
                taskId: "task_shell",
                name: "shell-lane",
                status: "running",
                lane: "worker",
                repoRoot: "/Users/tessaro/openclaw",
                worktreePath: "/Users/tessaro/openclaw/.worktrees/code/shell-lane",
                branch: "code/task_shell/shell-lane",
                backendId: "codex-cli",
                activeRunId: "run_shell",
                updatedAt: "2026-03-19T12:58:00.000Z"),
        ],
        pendingReviews: [
            CockpitReviewSummary(
                id: "review_shell",
                taskId: "task_shell",
                workerId: "worker_shell",
                title: "Review cockpit shell",
                status: "pending",
                summary: "Ready for diff and smoke test review.",
                updatedAt: "2026-03-19T12:59:00.000Z"),
        ],
        recentRuns: [
            CockpitRunSummary(
                id: "run_shell",
                taskId: "task_shell",
                workerId: "worker_shell",
                status: "running",
                summary: "Rendering native cockpit panels",
                backendId: "codex-cli",
                threadId: "thread_shell",
                startedAt: "2026-03-19T12:57:00.000Z",
                finishedAt: nil,
                terminationReason: nil,
                updatedAt: "2026-03-19T12:58:00.000Z"),
        ],
        activeLanes: [
            CockpitLaneSummary(
                taskId: "task_shell",
                taskTitle: "Ship the cockpit shell",
                workerId: "worker_shell",
                workerName: "shell-lane",
                lane: "worker",
                status: "running",
                repoRoot: "/Users/tessaro/openclaw",
                worktreePath: "/Users/tessaro/openclaw/.worktrees/code/shell-lane",
                branch: "code/task_shell/shell-lane",
                objective: "Render native cockpit panels and menu entry.",
                backendId: "codex-cli",
                activeRunId: "run_shell",
                updatedAt: "2026-03-19T12:58:00.000Z",
                latestRun: CockpitRunSummary(
                    id: "run_shell",
                    taskId: "task_shell",
                    workerId: "worker_shell",
                    status: "running",
                    summary: "Rendering native cockpit panels",
                    backendId: "codex-cli",
                    threadId: "thread_shell",
                    startedAt: "2026-03-19T12:57:00.000Z",
                    finishedAt: nil,
                    terminationReason: nil,
                    updatedAt: "2026-03-19T12:58:00.000Z"),
                pendingReview: CockpitReviewSummary(
                    id: "review_shell",
                    taskId: "task_shell",
                    workerId: "worker_shell",
                    title: "Review cockpit shell",
                    status: "pending",
                    summary: "Ready for diff and smoke test review.",
                    updatedAt: "2026-03-19T12:59:00.000Z")),
            CockpitLaneSummary(
                taskId: "task_review",
                taskTitle: "Tighten review lane",
                workerId: "worker_review",
                workerName: "review-lane",
                lane: "review",
                status: "paused",
                repoRoot: "/Users/tessaro/openclaw",
                worktreePath: "/Users/tessaro/openclaw/.worktrees/code/review-lane",
                branch: "code/task_review/review-lane",
                objective: "Validate recent diffs and smoke tests.",
                backendId: "codex-cli",
                activeRunId: nil,
                updatedAt: "2026-03-19T12:52:00.000Z",
                latestRun: CockpitRunSummary(
                    id: "run_review",
                    taskId: "task_review",
                    workerId: "worker_review",
                    status: "cancelled",
                    summary: "Paused for operator guidance",
                    backendId: "codex-cli",
                    threadId: "thread_review",
                    startedAt: "2026-03-19T12:48:00.000Z",
                    finishedAt: "2026-03-19T12:50:00.000Z",
                    terminationReason: "paused",
                    updatedAt: "2026-03-19T12:50:00.000Z"),
                pendingReview: nil),
        ])
}

extension CockpitWorkerLogs {
    static func preview(workerId: String) -> CockpitWorkerLogs {
        CockpitWorkerLogs(
            workerId: workerId,
            latestRun: CockpitWorkspaceSummary.preview.activeLanes.first(where: { $0.workerId == workerId })?.latestRun,
            stdoutTail: """
            > codex worker \(workerId)
            Rendering cockpit controls…
            Worker state refreshed.
            """,
            stderrTail: "")
    }
}
