(async () => {
  const result = document.querySelector("#result");
  const waitFor = async (condition, message) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const value = condition();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(message);
  };

  try {
    const snapshot = await fetch("/__fixture").then((response) => response.json());
    localStorage.setItem("studylogBridgeSnapshotV1", JSON.stringify(snapshot));
    localStorage.setItem("studylogDashboardPreferencesV1", JSON.stringify({ manualCompleted: [] }));
    const frame = document.createElement("iframe");
    frame.src = "/dashboard.html?view=tasks&now=2026-07-28T09:30:00";
    document.body.append(frame);
    await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    const doc = frame.contentDocument;
    await waitFor(() => doc.querySelector(".task-row"), "task rows did not render");
    const pendingBefore = doc.querySelectorAll(".task-row").length;
    doc.querySelector("[data-manual-toggle]:not([disabled])").click();
    await waitFor(() => doc.querySelectorAll(".task-row").length < pendingBefore, "manual completion was not reflected");
    doc.querySelector('[data-task-filter="manual"]').click();
    await waitFor(() => doc.querySelector(".manual-pill"), "manual completion list did not render");

    doc.querySelector('[data-view="attendance"]').click();
    await waitFor(() => doc.querySelector("#sim-rate"), "attendance simulator did not render");
    const before = doc.querySelector("#sim-rate").textContent;
    doc.querySelector('[data-sim-step="1"]').click();
    await waitFor(() => doc.querySelector("#sim-rate").textContent !== before, "simulator stepper did not update");
    const activeAttendanceRows = doc.querySelectorAll(".attendance-table tbody tr").length;
    doc.querySelector('[data-toggle-archives="attendance"]').click();
    await waitFor(() => doc.querySelectorAll(".attendance-table tbody tr").length > activeAttendanceRows, "archived attendance rows did not appear");

    doc.querySelector('[data-view="courses"]').click();
    await waitFor(() => doc.querySelector("[data-course-open]"), "course cards did not render");
    const activeCourseCards = doc.querySelectorAll(".course-card").length;
    doc.querySelector('[data-toggle-archives="courses"]').click();
    await waitFor(() => doc.querySelectorAll(".course-card").length > activeCourseCards, "archived course cards did not appear");
    doc.querySelector("[data-course-open]").click();
    await waitFor(() => doc.querySelector("#course-dialog").open, "course dialog did not open");

    result.textContent = "interaction test: ok";
    document.body.dataset.testResult = "ok";
  } catch (error) {
    result.textContent = `interaction test: failed: ${error.message}`;
    document.body.dataset.testResult = "failed";
  }
})();
