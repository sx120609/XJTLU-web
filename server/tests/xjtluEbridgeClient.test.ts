import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "xjtlu-ebridge-test-secret";

const portalHtml = `<!doctype html><html><head><title>e:Vision Portal</title></head><body>
  <div>Test Student (<a href="SIW_LGN_LOGOUT.start_url?logout">Logout</a>)</div>
  <a href="siw_portal.url?home">Home Page</a>
  <a href="siw_portal.url?records">Academic Records</a>
  <a href="siw_portal.url?timetable">Timetables</a>
</body></html>`;

const recordsHtml = `<!doctype html><html><body>
  <div>Test Student (<a>Logout</a>)</div><a>Home Page</a>
  <h1>Academic Records</h1>
  <a href="SIW_POD.start_url?full-records">Full Academic Records</a>
  <a href="SIW_POD.start_url?component-marks">Component Marks (2025/26)</a>
</body></html>`;

const componentMarksHtml = `<!doctype html><html><body>
  <h2>EEE109 Electronic Circuits - 2025/26 SEM2 - 5 Credits</h2>
  <table><thead><tr><th>Assessment Title</th><th>Assessment Type</th><th>Percentage</th><th>Marks</th></tr></thead>
  <tbody><tr><td>Lab Assessment</td><td>Coursework</td><td>40%</td><td></td></tr><tr><td>Final Exam</td><td>Examination</td><td>60%</td><td></td></tr></tbody></table>
</body></html>`;

const fullRecordsHtml = `<!doctype html><html><body>
  <div>Student ID</div><div>2469480</div><div>Student Name</div><div>Test Student</div>
  <p>For 2+2 students, academic records achieved elsewhere are updated later.</p>
  <h2>2025/26 Academic Year Records</h2>
  <table><thead><tr><th>Period</th><th>Module Code</th><th>Module Title</th><th>Credit</th><th>Mark</th><th>Grade</th><th>Attempt</th><th>Component Marks</th></tr></thead>
  <tbody><tr><td>SEM1</td><td>CPT109</td><td>C Programming</td><td>5.0</td><td>94%</td><td>P</td><td>1</td><td>
    <div style="display:none"><table><tr><th>Component title</th><th>Assessment type</th><th>Weight</th><th>Mark</th></tr>
    <tr><td>Continuous Assessment</td><td>Coursework</td><td>15%</td><td>100.00%</td></tr>
    <tr><td>Final Exam</td><td>Examination</td><td>85%</td><td>93.00%</td></tr></table></div>
  </td></tr></tbody></table>
  <p>Additional Learning</p>
  <table><thead><tr><th>Period</th><th>Module Code</th><th>Module Title</th><th>Mark</th><th>Grade</th><th>Component Marks</th></tr></thead>
  <tbody><tr><td>SEM1</td><td>CCT009</td><td>Chinese and Western Culture</td><td>76%</td><td>P</td><td>View</td></tr></tbody></table>
</body></html>`;

const timetableHtml = `<!doctype html><html><body>
  <h1>Timetables</h1><h2>My Examination Timetable</h2>
  <a href="SIW_POD.start_url?personal">My Personal Class Timetable - 2025/26 S2</a>
  <table><thead><tr><th>Module Code</th><th>Module Title</th><th>Date</th><th>Day</th><th>Admission Time</th><th>Exam Start Time</th><th>Exam Duration</th><th>Exam Room/Campus</th><th>Seat No.</th><th>Area</th><th>Entrance</th></tr></thead>
  <tbody><tr><td>MTH102</td><td>Engineering Mathematics II</td><td>06 Jun 2026</td><td>Saturday</td><td>9:30AM</td><td>10:00AM</td><td>2h</td><td>South Campus</td><td>S14</td><td>Green-3</td><td>Ground floor</td></tr></tbody></table>
</body></html>`;

const timetableHash = "Aa".repeat(32);
const personalTimetableHtml = `<!doctype html><html><body>
  <h1>My Timetable</h1>
  <iframe src="https://timetableplus.xjtlu.edu.cn/pt/#/${timetableHash}?start=1&amp;end=13"></iframe>
</body></html>`;

const timetableActivities = [{
  weekPattern: "2, 4-5, 8",
  scheduledDay: "2",
  startTime: "2000-01-01T07:00:00Z",
  endTime: "2000-01-01T08:00:00Z",
  activityType: "Tutorial",
  staff: "Gangmin Li, XUE YAO",
  location: " SIP-EB409",
  moduleId: "SAT102",
  identity: "activity-1",
  name: "SAT102-Tutorial-D4/19",
}];

test("XJTLU eBridge exchanges SSO and parses academic records and exams", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let fetchCount = 0;
  let activeHomeRequests = 0;
  let maxActiveHomeRequests = 0;

  globalThis.fetch = async (input, init = {}) => {
    fetchCount += 1;
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const cookies = headers.get("Cookie") || "";
    assert.equal(init.redirect, "manual");

    if (url.pathname.endsWith("/siw_sso.openid")) {
      assert.doesNotMatch(cookies, /UIM_SESSION/);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://uim.xjtlu.edu.cn/esc-sso/oidc/authorize?client_id=test",
          "Set-Cookie": "EBRIDGE_SESSION=ready; Path=/; Secure; HttpOnly",
        },
      });
    }
    if (url.origin === "https://uim.xjtlu.edu.cn") {
      assert.match(cookies, /UIM_SESSION=authenticated/);
      assert.doesNotMatch(cookies, /EBRIDGE_SESSION/);
      return new Response(null, {
        status: 302,
        headers: { Location: "https://ebridge.xjtlu.edu.cn/urd/sits.urd/run/siw_sso.openid_response?code=test" },
      });
    }
    if (url.pathname.endsWith("/siw_sso.openid_response")) {
      assert.match(cookies, /EBRIDGE_SESSION=ready/);
      return new Response(`<html><head><title>User Redirect</title></head><body><script>window.location.href="siw_portal.url?home";</script></body></html>`);
    }
    if (url.search === "?home") {
      activeHomeRequests += 1;
      maxActiveHomeRequests = Math.max(maxActiveHomeRequests, activeHomeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeHomeRequests -= 1;
      return new Response(portalHtml);
    }
    if (url.search === "?records") return new Response(recordsHtml);
    if (url.search === "?timetable") return new Response(timetableHtml);
    if (url.search === "?personal") return new Response(personalTimetableHtml);
    if (url.search === "?full-records") return new Response(fullRecordsHtml);
    if (url.search === "?component-marks") return new Response(componentMarksHtml);
    if (url.origin === "https://timetableplus.xjtlu.edu.cn") {
      assert.equal(cookies, "");
      assert.equal(url.pathname, `/ptapi/api/enrollment/hash/${timetableHash}/activity`);
      assert.equal(url.search, "?start=1&end=13");
      return Response.json(timetableActivities);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const {
    clearXjtluEbridgeSession,
    establishXjtluEbridgeSession,
    getXjtluAcademicOverview,
    getXjtluAcademicSchedule,
    getXjtluEbridgeStatus,
  } = await import("../src/services/xjtluEbridgeClient");

  await establishXjtluEbridgeSession(1991, "student.name24", { UIM_SESSION: "authenticated" });
  assert.deepEqual(await getXjtluEbridgeStatus(1991), {
    active: true,
    username: "student.name24",
    displayName: "Test Student",
  });
  const [overview, schedule] = await Promise.all([
    getXjtluAcademicOverview(1991),
    getXjtluAcademicSchedule(1991),
  ]);
  assert.equal(maxActiveHomeRequests, 1, "same-user eBridge requests must not race cookie snapshots");
  assert.deepEqual(overview.student, { id: "2469480", name: "Test Student" });
  assert.equal(overview.academicYear, "2025/26");
  assert.equal(overview.grades.length, 3);
  assert.deepEqual(overview.grades[0], {
    academicYear: "2025/26",
    period: "SEM1",
    moduleCode: "CPT109",
    moduleTitle: "C Programming",
    credit: "5.0",
    mark: "94%",
    grade: "P",
    attempt: "1",
    additionalLearning: false,
    components: [{
      title: "Continuous Assessment",
      type: "Coursework",
      percentage: "15%",
      mark: "100.00%",
    }, {
      title: "Final Exam",
      type: "Examination",
      percentage: "85%",
      mark: "93.00%",
    }],
  });
  assert.equal(overview.grades[1].additionalLearning, true);
  assert.deepEqual(overview.grades[2], {
    academicYear: "2025/26",
    period: "SEM2",
    moduleCode: "EEE109",
    moduleTitle: "Electronic Circuits",
    credit: "5",
    mark: "",
    grade: "",
    attempt: "",
    additionalLearning: false,
    components: [{
      title: "Lab Assessment",
      type: "Coursework",
      percentage: "40%",
      mark: "",
    }, {
      title: "Final Exam",
      type: "Examination",
      percentage: "60%",
      mark: "",
    }],
  });
  assert.equal(overview.exams.length, 1);
  assert.deepEqual(overview.exams[0], {
    moduleCode: "MTH102",
    moduleTitle: "Engineering Mathematics II",
    date: "06 Jun 2026",
    day: "Saturday",
    admissionTime: "9:30AM",
    startTime: "10:00AM",
    duration: "2h",
    room: "South Campus",
    seat: "S14",
    area: "Green-3",
    entrance: "Ground floor",
  });
  assert.equal(schedule.parsed.currentSemester, "2025/26-S2");
  assert.equal(schedule.parsed.weeks.length, 13);
  assert.equal(schedule.calendar.semesterStart, "2026-03-02");
  assert.equal(schedule.calendar.semesterEnd, "2026-05-31");
  assert.deepEqual(schedule.parsed.cells, [{
    day: 3,
    bigSlot: 4,
    courses: [{
      name: "SAT102-Tutorial-D4/19",
      teacher: "Gangmin Li, XUE YAO",
      weeks: "2, 4-5, 8",
      weekList: [2, 4, 5, 8],
      location: "SIP-EB409",
      slotNote: "15:00 - 15:50",
      startSlot: 7,
      endSlot: 7,
      sourceKey: "activity-1",
    }],
  }]);
  assert.doesNotMatch(JSON.stringify(schedule), new RegExp(timetableHash));
  const fetchCountAfterFirstLoad = fetchCount;
  await getXjtluAcademicSchedule(1991);
  assert.ok(fetchCount > fetchCountAfterFirstLoad, "academic timetable should always use live school data");
  await clearXjtluEbridgeSession(1991);
  assert.deepEqual(await getXjtluEbridgeStatus(1991), { active: false });
});

test("XJTLU eBridge rejects redirects outside its authentication allowlist", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { Location: "https://attacker.example/steal" },
  });
  const { establishXjtluEbridgeSession } = await import("../src/services/xjtluEbridgeClient");
  await assert.rejects(
    () => establishXjtluEbridgeSession(1992, "student.name24", { UIM_SESSION: "authenticated" }),
    /非预期登录跳转/,
  );
});
