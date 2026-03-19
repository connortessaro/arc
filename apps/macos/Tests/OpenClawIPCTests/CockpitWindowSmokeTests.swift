import SwiftUI
import Testing
@testable import OpenClaw

@Suite(.serialized)
@MainActor
struct CockpitWindowSmokeTests {
    @Test func `cockpit window builds body with preview snapshot`() {
        let store = CockpitStore.preview
        let view = CockpitWindow(store: store)
        _ = view.body
    }

    @Test func `cockpit window builds body with selected worker detail`() {
        let store = CockpitStore.preview
        store.selectedWorkerId = "worker_shell"
        store.selectedWorkerLogs = .preview(workerId: "worker_shell")
        let view = CockpitWindow(store: store)
        _ = view.body
    }

    @Test func `cockpit window builds body with remote gateway status`() {
        let store = CockpitStore.preview
        store.gatewayStatus = CockpitGatewayStatus(
            mode: .remote,
            state: .ready,
            endpointLabel: "127.0.0.1:18789",
            detail: nil)
        let view = CockpitWindow(store: store)
        _ = view.body
    }
}
