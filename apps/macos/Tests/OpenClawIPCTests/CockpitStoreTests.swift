import Foundation
import Testing
@testable import OpenClaw

actor CockpitStoreRecorder {
    private(set) var summaryLoads = 0
    private(set) var gatewayStatusLoads = 0
    private(set) var logRequests: [String] = []
    private(set) var actions: [String] = []
    private(set) var supervisorTicks: [String?] = []
    private(set) var remoteReconnects = 0

    func loadSummary(_ summary: CockpitWorkspaceSummary) -> CockpitWorkspaceSummary {
        self.summaryLoads += 1
        return summary
    }

    func loadGatewayStatus(_ status: CockpitGatewayStatus) -> CockpitGatewayStatus {
        self.gatewayStatusLoads += 1
        return status
    }

    func loadLogs(workerId: String, logs: CockpitWorkerLogs) -> CockpitWorkerLogs {
        self.logRequests.append(workerId)
        return logs
    }

    func perform(action: CockpitWorkerAction, workerId: String) {
        self.actions.append("\(action.rawValue):\(workerId)")
    }

    func performSupervisorTick(repoRoot: String?) {
        self.supervisorTicks.append(repoRoot)
    }

    func reconnectRemoteGateway() {
        self.remoteReconnects += 1
    }
}

actor GatewayStatusSequence {
    private var statuses: [CockpitGatewayStatus]

    init(statuses: [CockpitGatewayStatus]) {
        self.statuses = statuses
    }

    func next() -> CockpitGatewayStatus {
        self.statuses.removeFirst()
    }
}

@Suite(.serialized)
@MainActor
struct CockpitStoreTests {
    @Test func `available worker actions reflect lane status`() {
        let runningLane = CockpitWorkspaceSummary.preview.activeLanes.first { $0.workerId == "worker_shell" }
        #expect(runningLane != nil)
        #expect(runningLane?.availableWorkerActions ?? [] == [.pause, .cancel])

        let pausedLane = CockpitWorkspaceSummary.preview.activeLanes.first { $0.workerId == "worker_review" }
        #expect(pausedLane != nil)
        #expect(pausedLane?.availableWorkerActions ?? [] == [.resume, .cancel])
    }

    @Test func `worker action dispatch refreshes summary and loads selected logs`() async {
        let refreshed = CockpitWorkspaceSummary.preview
        let expectedLogs = CockpitWorkerLogs.preview(workerId: "worker_shell")
        let expectedGatewayStatus = CockpitGatewayStatus(
            mode: .local,
            state: .ready,
            endpointLabel: "127.0.0.1:18789",
            detail: nil)
        let recorder = CockpitStoreRecorder()

        let store = CockpitStore(
            isPreview: false,
            loadGatewayStatus: {
                await recorder.loadGatewayStatus(expectedGatewayStatus)
            },
            loadSummary: {
                await recorder.loadSummary(refreshed)
            },
            loadWorkerLogs: { workerId in
                await recorder.loadLogs(workerId: workerId, logs: expectedLogs)
            },
            performWorkerAction: { action, workerId in
                await recorder.perform(action: action, workerId: workerId)
            })

        await store.refresh()

        #expect(store.selectedWorkerId == "worker_shell")
        #expect(store.selectedWorkerLogs?.workerId == "worker_shell")

        await store.performWorkerAction(.pause, workerId: "worker_shell")

        let actions = await recorder.actions
        let gatewayStatusLoads = await recorder.gatewayStatusLoads
        let summaryLoads = await recorder.summaryLoads
        let logRequests = await recorder.logRequests
        #expect(actions == ["pause:worker_shell"])
        #expect(gatewayStatusLoads == 2)
        #expect(summaryLoads == 2)
        #expect(logRequests == ["worker_shell", "worker_shell"])
        #expect(store.gatewayStatus == expectedGatewayStatus)
    }

    @Test func `start next worker dispatch refreshes summary and selects returned worker`() async {
        let refreshed = CockpitWorkspaceSummary.preview
        let expectedLogs = CockpitWorkerLogs.preview(workerId: "worker_review")
        let expectedGatewayStatus = CockpitGatewayStatus(
            mode: .local,
            state: .ready,
            endpointLabel: "127.0.0.1:18789",
            detail: nil)
        let recorder = CockpitStoreRecorder()
        let startedWorker = CockpitWorkerSummary(
            id: "worker_review",
            taskId: "task_review",
            name: "review-lane",
            status: "running",
            lane: "review",
            repoRoot: "/Users/tessaro/openclaw",
            worktreePath: "/Users/tessaro/openclaw/.worktrees/code/review-lane",
            branch: "code/task_review/review-lane",
            backendId: "codex-cli",
            activeRunId: "run_review",
            updatedAt: "2026-03-19T13:02:00.000Z")

        let store = CockpitStore(
            isPreview: false,
            loadGatewayStatus: {
                await recorder.loadGatewayStatus(expectedGatewayStatus)
            },
            loadSummary: {
                await recorder.loadSummary(refreshed)
            },
            loadWorkerLogs: { workerId in
                await recorder.loadLogs(workerId: workerId, logs: expectedLogs)
            },
            performSupervisorTick: { repoRoot in
                await recorder.performSupervisorTick(repoRoot: repoRoot)
                return CockpitSupervisorTickResult(
                    action: "started",
                    reason: nil,
                    task: nil,
                    worker: startedWorker,
                    run: nil)
            })

        await store.refresh()
        await store.startNextWorker()

        let supervisorTicks = await recorder.supervisorTicks
        let gatewayStatusLoads = await recorder.gatewayStatusLoads
        let summaryLoads = await recorder.summaryLoads
        let logRequests = await recorder.logRequests

        #expect(supervisorTicks == ["/Users/tessaro/openclaw"])
        #expect(gatewayStatusLoads == 2)
        #expect(summaryLoads == 2)
        #expect(logRequests == ["worker_shell", "worker_review"])
        #expect(store.selectedWorkerId == "worker_review")
        #expect(store.selectedWorkerLogs?.workerId == "worker_review")
    }

    @Test func `remote reconnect refreshes gateway status and summary`() async {
        let expectedLogs = CockpitWorkerLogs.preview(workerId: "worker_shell")
        let initialGatewayStatus = CockpitGatewayStatus(
            mode: .remote,
            state: .unavailable,
            endpointLabel: nil,
            detail: "Remote control tunnel failed")
        let reconnectedGatewayStatus = CockpitGatewayStatus(
            mode: .remote,
            state: .ready,
            endpointLabel: "127.0.0.1:18789",
            detail: nil)
        let recorder = CockpitStoreRecorder()
        let gatewayStatuses = GatewayStatusSequence(
            statuses: [initialGatewayStatus, reconnectedGatewayStatus])

        let store = CockpitStore(
            isPreview: false,
            loadGatewayStatus: {
                let next = await gatewayStatuses.next()
                return await recorder.loadGatewayStatus(next)
            },
            loadSummary: {
                await recorder.loadSummary(.preview)
            },
            loadWorkerLogs: { workerId in
                await recorder.loadLogs(workerId: workerId, logs: expectedLogs)
            },
            reconnectRemoteGateway: {
                await recorder.reconnectRemoteGateway()
            })

        await store.refresh()

        #expect(store.gatewayStatus == initialGatewayStatus)

        await store.reconnectRemoteGateway()

        let gatewayStatusLoads = await recorder.gatewayStatusLoads
        let summaryLoads = await recorder.summaryLoads
        let remoteReconnects = await recorder.remoteReconnects

        #expect(remoteReconnects == 1)
        #expect(gatewayStatusLoads == 2)
        #expect(summaryLoads == 2)
        #expect(store.gatewayStatus == reconnectedGatewayStatus)
    }
}
