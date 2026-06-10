// Security-rules tests for firestore.rules. These run against the Firestore
// emulator and are excluded from plain `npm test` — run them via
// `npm run test:rules` (firebase emulators:exec + vitest.rules.config.mts).
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import {
  ADMIN,
  ALICE,
  BOB,
  CAROL,
  CONTRIBUTOR,
  createRulesTestEnv,
  EDITOR,
  firestoreOf,
} from "./helpers";

let testEnv: RulesTestEnvironment;

const alice = () =>
  firestoreOf(
    testEnv.authenticatedContext(ALICE, { email: "alice@example.com" }),
  );
const bob = () => firestoreOf(testEnv.authenticatedContext(BOB));
const carol = () => firestoreOf(testEnv.authenticatedContext(CAROL));
const admin = () =>
  firestoreOf(testEnv.authenticatedContext(ADMIN, { admin: true }));
const editor = () =>
  firestoreOf(testEnv.authenticatedContext(EDITOR, { editor: true }));
const contributor = () =>
  firestoreOf(
    testEnv.authenticatedContext(CONTRIBUTOR, { contributor: true }),
  );
const anon = () => firestoreOf(testEnv.unauthenticatedContext());

// Seed docs with rules disabled (stand-in for Admin SDK writes from
// Server Actions, which bypass security rules in production).
async function seed(docs: Record<string, Record<string, unknown>>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = firestoreOf(ctx);
    for (const [path, data] of Object.entries(docs)) {
      await setDoc(doc(db, path), data);
    }
  });
}

beforeAll(async () => {
  // Silence the SDK's noisy warnings for the permission denials we assert.
  setLogLevel("error");
  testEnv = await createRulesTestEnv();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  // `testEnv` is undefined if `createRulesTestEnv()` threw in beforeAll;
  // guard so cleanup doesn't mask the real initialization error.
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("users", () => {
  const profile = {
    uid: ALICE,
    email: "alice@example.com",
    displayName: "Alice",
  };

  it("profile is readable only by the owner and admins", async () => {
    await seed({ [`users/${ALICE}`]: profile });
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}`)));
    await assertSucceeds(getDoc(doc(admin(), `users/${ALICE}`)));
    await assertFails(getDoc(doc(bob(), `users/${ALICE}`)));
    await assertFails(getDoc(doc(anon(), `users/${ALICE}`)));
  });

  it("owner can create own profile; email must match the auth token", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `users/${ALICE}`), {
        ...profile,
        eventAttendanceCount: 0,
      }),
    );
    await assertFails(
      setDoc(doc(alice(), `users/${BOB}`), { ...profile, uid: BOB }),
    );
    await assertFails(
      setDoc(doc(alice(), `users/${ALICE}`), {
        ...profile,
        email: "spoofed@example.com",
      }),
    );
  });

  it("create cannot seed the attendance counter or its audit fields", async () => {
    await assertFails(
      setDoc(doc(alice(), `users/${ALICE}`), {
        ...profile,
        eventAttendanceCount: 42,
      }),
    );
    await assertFails(
      setDoc(doc(alice(), `users/${ALICE}`), {
        ...profile,
        eventAttendanceCountEditedAt: new Date(),
      }),
    );
  });

  it("owner update cannot change email or touch the attendance counter", async () => {
    await seed({ [`users/${ALICE}`]: profile });
    await assertSucceeds(
      updateDoc(doc(alice(), `users/${ALICE}`), { displayName: "Alice 2" }),
    );
    await assertFails(
      updateDoc(doc(alice(), `users/${ALICE}`), {
        email: "evil@example.com",
      }),
    );
    await assertFails(
      updateDoc(doc(alice(), `users/${ALICE}`), { eventAttendanceCount: 99 }),
    );
  });

  it("only admin can delete a profile", async () => {
    await seed({ [`users/${ALICE}`]: profile });
    await assertFails(deleteDoc(doc(alice(), `users/${ALICE}`)));
    await assertSucceeds(deleteDoc(doc(admin(), `users/${ALICE}`)));
  });
});

describe("events", () => {
  it("read visibility: published is public, members_only needs sign-in, draft is admin-only", async () => {
    await seed({
      "events/pub": { title: "Meetup", status: "published", visibility: "public" },
      "events/members": {
        title: "Members night",
        status: "published",
        visibility: "members_only",
      },
      "events/draft": { title: "WIP", status: "draft" },
    });
    await assertSucceeds(getDoc(doc(anon(), "events/pub")));
    await assertFails(getDoc(doc(anon(), "events/members")));
    await assertSucceeds(getDoc(doc(alice(), "events/members")));
    await assertFails(getDoc(doc(anon(), "events/draft")));
    await assertFails(getDoc(doc(alice(), "events/draft")));
    await assertSucceeds(getDoc(doc(admin(), "events/draft")));
  });

  it("only admin can create events", async () => {
    await assertFails(
      setDoc(doc(alice(), "events/new"), { title: "Rogue", status: "published" }),
    );
    await assertSucceeds(
      setDoc(doc(admin(), "events/new"), { title: "Real", status: "published" }),
    );
  });
});

describe("events/{id}/rsvps", () => {
  it("rsvp is readable only by its owner and admins", async () => {
    await seed({
      [`events/evt1/rsvps/${ALICE}`]: { uid: ALICE, status: "confirmed" },
    });
    await assertSucceeds(getDoc(doc(alice(), `events/evt1/rsvps/${ALICE}`)));
    await assertSucceeds(getDoc(doc(admin(), `events/evt1/rsvps/${ALICE}`)));
    await assertFails(getDoc(doc(bob(), `events/evt1/rsvps/${ALICE}`)));
  });

  it("owner create cannot set server-managed fields or use another uid", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `events/evt1/rsvps/${ALICE}`), {
        uid: ALICE,
        status: "confirmed",
      }),
    );
    await assertFails(
      setDoc(doc(alice(), `events/evt2/rsvps/${ALICE}`), {
        uid: ALICE,
        status: "confirmed",
        attendedAt: new Date(),
      }),
    );
    await assertFails(
      setDoc(doc(alice(), `events/evt2/rsvps/${ALICE}`), {
        uid: ALICE,
        status: "confirmed",
        isGuest: false,
      }),
    );
    await assertFails(
      setDoc(doc(alice(), `events/evt2/rsvps/${BOB}`), {
        uid: BOB,
        status: "confirmed",
      }),
    );
  });

  it("owner cannot spoof attendance via update; admin check-in can", async () => {
    await seed({
      [`events/evt1/rsvps/${ALICE}`]: { uid: ALICE, status: "confirmed" },
    });
    await assertSucceeds(
      updateDoc(doc(alice(), `events/evt1/rsvps/${ALICE}`), {
        status: "cancelled",
      }),
    );
    await assertFails(
      updateDoc(doc(alice(), `events/evt1/rsvps/${ALICE}`), {
        attendedAt: new Date(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(admin(), `events/evt1/rsvps/${ALICE}`), {
        attendedAt: new Date(),
        isGuest: false,
      }),
    );
  });
});

describe("events/{id}/presentations", () => {
  it("signed-in user can create a presentation only as themselves", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "events/evt1/presentations/p1"), {
        presenterUid: ALICE,
        title: "My talk",
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "events/evt1/presentations/p2"), {
        presenterUid: BOB,
        title: "Spoofed talk",
      }),
    );
  });

  it("only the presenter or admin can update", async () => {
    await seed({
      "events/evt1/presentations/p1": { presenterUid: ALICE, title: "Talk" },
    });
    await assertSucceeds(
      updateDoc(doc(alice(), "events/evt1/presentations/p1"), { title: "v2" }),
    );
    await assertFails(
      updateDoc(doc(bob(), "events/evt1/presentations/p1"), { title: "hax" }),
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "events/evt1/presentations/p1"), { title: "v3" }),
    );
  });
});

describe("projects", () => {
  const pendingProject = {
    ownerUid: ALICE,
    title: "My app",
    status: "pending",
    reviewerUid: null,
    likeCount: 0,
  };

  it("pending project is hidden from everyone but owner and admin", async () => {
    await seed({
      "projects/pending1": pendingProject,
      "projects/approved1": { ...pendingProject, ownerUid: BOB, status: "approved" },
    });
    await assertFails(getDoc(doc(anon(), "projects/pending1")));
    await assertFails(getDoc(doc(bob(), "projects/pending1")));
    await assertSucceeds(getDoc(doc(alice(), "projects/pending1")));
    await assertSucceeds(getDoc(doc(admin(), "projects/pending1")));
    await assertSucceeds(getDoc(doc(anon(), "projects/approved1")));
  });

  it("create must start pending with a zero likeCount", async () => {
    await assertSucceeds(setDoc(doc(alice(), "projects/p1"), pendingProject));
    await assertFails(
      setDoc(doc(alice(), "projects/p2"), {
        ...pendingProject,
        status: "approved",
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "projects/p3"), {
        ...pendingProject,
        likeCount: 25,
      }),
    );
  });

  it("owner cannot self-approve or bump the like counter", async () => {
    await seed({ "projects/p1": pendingProject });
    await assertSucceeds(
      updateDoc(doc(alice(), "projects/p1"), { title: "Better title" }),
    );
    await assertFails(
      updateDoc(doc(alice(), "projects/p1"), { status: "approved" }),
    );
    await assertFails(updateDoc(doc(alice(), "projects/p1"), { likeCount: 50 }));
  });

  it("likes are readable but never client-writable", async () => {
    await seed({
      "projects/approved1": { ...pendingProject, status: "approved" },
      [`projects/approved1/likes/${BOB}`]: { createdAt: new Date() },
    });
    await assertSucceeds(
      getDoc(doc(anon(), `projects/approved1/likes/${BOB}`)),
    );
    await assertFails(
      setDoc(doc(alice(), `projects/approved1/likes/${ALICE}`), {
        createdAt: new Date(),
      }),
    );
  });
});

describe("projects/{id}/comments (approved-gating + owner peek)", () => {
  // Showcase project comments differ from posts/guides/qa: the parent gate
  // is `status == 'approved'` (not 'published'), and the project owner can
  // read comments even while the project is still pending/rejected.
  const pendingProject = { ownerUid: ALICE, title: "My app", status: "pending" };
  const approvedProject = {
    ownerUid: ALICE,
    title: "My app",
    status: "approved",
  };
  const bobComment = {
    authorUid: BOB,
    parentType: "project",
    parentId: "pending1",
    body: "Looks promising",
    likeCount: 0,
  };

  it("comments on a pending project are visible to the owner but hidden from others", async () => {
    await seed({
      "projects/pending1": pendingProject,
      "projects/pending1/comments/c1": bobComment,
    });
    // Owner (Alice) can peek even though the project isn't approved yet.
    await assertSucceeds(getDoc(doc(alice(), "projects/pending1/comments/c1")));
    // The comment author (Bob) always sees their own.
    await assertSucceeds(getDoc(doc(bob(), "projects/pending1/comments/c1")));
    await assertSucceeds(getDoc(doc(admin(), "projects/pending1/comments/c1")));
    // A bystander and anon cannot — the project isn't public.
    await assertFails(getDoc(doc(carol(), "projects/pending1/comments/c1")));
    await assertFails(getDoc(doc(anon(), "projects/pending1/comments/c1")));
  });

  it("comments on an approved project are public", async () => {
    await seed({
      "projects/approved1": approvedProject,
      "projects/approved1/comments/c1": { ...bobComment, parentId: "approved1" },
    });
    await assertSucceeds(getDoc(doc(anon(), "projects/approved1/comments/c1")));
    await assertSucceeds(getDoc(doc(carol(), "projects/approved1/comments/c1")));
  });

  it("create needs an approved parent and a consistent parent path", async () => {
    await seed({
      "projects/pending1": pendingProject,
      "projects/approved1": approvedProject,
    });
    // Parent still pending → no public comments yet.
    await assertFails(
      setDoc(doc(bob(), "projects/pending1/comments/c2"), bobComment),
    );
    // Path/parentId mismatch is rejected even when the parent is approved.
    await assertFails(
      setDoc(doc(bob(), "projects/approved1/comments/c2"), {
        ...bobComment,
        parentId: "pending1",
      }),
    );
    // Spoofing parentType is rejected.
    await assertFails(
      setDoc(doc(bob(), "projects/approved1/comments/c3"), {
        ...bobComment,
        parentType: "post",
        parentId: "approved1",
      }),
    );
    await assertSucceeds(
      setDoc(doc(bob(), "projects/approved1/comments/c4"), {
        ...bobComment,
        parentId: "approved1",
      }),
    );
  });

  it("author may edit only body/updatedAt/deletedAt; hard delete is admin-only", async () => {
    await seed({
      "projects/approved1": approvedProject,
      "projects/approved1/comments/c1": { ...bobComment, parentId: "approved1" },
    });
    await assertSucceeds(
      updateDoc(doc(bob(), "projects/approved1/comments/c1"), {
        body: "edited",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(bob(), "projects/approved1/comments/c1"), {
        likeCount: 999,
      }),
    );
    await assertFails(
      updateDoc(doc(carol(), "projects/approved1/comments/c1"), {
        body: "not yours",
      }),
    );
    await assertFails(deleteDoc(doc(bob(), "projects/approved1/comments/c1")));
    await assertSucceeds(
      deleteDoc(doc(admin(), "projects/approved1/comments/c1")),
    );
  });
});

describe("posts/{id}/comments (parent visibility gating)", () => {
  const draftPost = {
    authorUid: BOB,
    title: "Draft",
    status: "draft",
    reviewerUid: null,
  };
  const publishedPost = {
    authorUid: BOB,
    title: "Hello",
    status: "published",
    reviewerUid: null,
  };
  const aliceComment = {
    authorUid: ALICE,
    parentType: "post",
    parentId: "draft1",
    body: "Nice draft",
    likeCount: 0,
  };

  it("comments under a non-published post are hidden from other users", async () => {
    await seed({
      "posts/draft1": draftPost,
      "posts/draft1/comments/c1": aliceComment,
    });
    await assertFails(getDoc(doc(carol(), "posts/draft1/comments/c1")));
    await assertFails(getDoc(doc(anon(), "posts/draft1/comments/c1")));
    await assertSucceeds(getDoc(doc(alice(), "posts/draft1/comments/c1")));
    await assertSucceeds(getDoc(doc(admin(), "posts/draft1/comments/c1")));
  });

  it("create requires a published parent and a consistent parent path", async () => {
    await seed({ "posts/draft1": draftPost, "posts/pub1": publishedPost });
    await assertFails(
      setDoc(doc(alice(), "posts/draft1/comments/c2"), aliceComment),
    );
    await assertFails(
      setDoc(doc(alice(), "posts/pub1/comments/c2"), {
        ...aliceComment,
        parentId: "draft1",
      }),
    );
    await assertSucceeds(
      setDoc(doc(alice(), "posts/pub1/comments/c2"), {
        ...aliceComment,
        parentId: "pub1",
      }),
    );
  });

  it("author may edit only body/updatedAt/deletedAt", async () => {
    await seed({
      "posts/pub1": publishedPost,
      "posts/pub1/comments/c1": { ...aliceComment, parentId: "pub1" },
    });
    await assertSucceeds(
      updateDoc(doc(alice(), "posts/pub1/comments/c1"), {
        body: "edited",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(alice(), "posts/pub1/comments/c1"), { likeCount: 999 }),
    );
    await assertFails(
      updateDoc(doc(bob(), "posts/pub1/comments/c1"), { body: "not yours" }),
    );
  });

  it("hard delete is admin-only (authors soft-delete via update)", async () => {
    await seed({
      "posts/pub1": publishedPost,
      "posts/pub1/comments/c1": { ...aliceComment, parentId: "pub1" },
    });
    await assertFails(deleteDoc(doc(alice(), "posts/pub1/comments/c1")));
    await assertSucceeds(deleteDoc(doc(admin(), "posts/pub1/comments/c1")));
  });
});

describe("guides (role ladder)", () => {
  it("plain user can create draft/pending but not published, nor fake a reviewer", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "guides/g1"), {
        authorUid: ALICE,
        title: "Setup guide",
        status: "pending",
        reviewerUid: null,
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "guides/g2"), {
        authorUid: ALICE,
        title: "Self-published",
        status: "published",
        reviewerUid: null,
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "guides/g3"), {
        authorUid: ALICE,
        title: "Fake review",
        status: "pending",
        reviewerUid: BOB,
      }),
    );
  });

  it("contributor can self-publish own guide but cannot touch others' guides", async () => {
    await seed({
      "guides/bobs": {
        authorUid: BOB,
        title: "Bob's guide",
        status: "pending",
        reviewerUid: null,
      },
    });
    await assertSucceeds(
      setDoc(doc(contributor(), "guides/c1"), {
        authorUid: CONTRIBUTOR,
        title: "Trusted guide",
        status: "published",
        reviewerUid: null,
      }),
    );
    await assertFails(
      updateDoc(doc(contributor(), "guides/bobs"), { title: "hijacked" }),
    );
  });

  it("editor can edit and publish anyone's guide", async () => {
    await seed({
      "guides/bobs": {
        authorUid: BOB,
        title: "Bob's guide",
        status: "pending",
        reviewerUid: null,
      },
    });
    await assertSucceeds(
      updateDoc(doc(editor(), "guides/bobs"), { status: "published" }),
    );
  });

  it("plain author cannot self-publish via update", async () => {
    await seed({
      "guides/alices": {
        authorUid: ALICE,
        title: "Mine",
        status: "draft",
        reviewerUid: null,
      },
    });
    await assertFails(
      updateDoc(doc(alice(), "guides/alices"), { status: "published" }),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), "guides/alices"), { status: "pending" }),
    );
  });

  it("draft guides are visible only to author, editor and admin", async () => {
    await seed({
      "guides/draft-g": {
        authorUid: ALICE,
        title: "WIP",
        status: "draft",
        reviewerUid: null,
      },
      "guides/pub-g": {
        authorUid: BOB,
        title: "Done",
        status: "published",
        reviewerUid: null,
      },
    });
    await assertFails(getDoc(doc(bob(), "guides/draft-g")));
    await assertFails(getDoc(doc(anon(), "guides/draft-g")));
    await assertSucceeds(getDoc(doc(alice(), "guides/draft-g")));
    await assertSucceeds(getDoc(doc(editor(), "guides/draft-g")));
    await assertSucceeds(getDoc(doc(anon(), "guides/pub-g")));
  });
});

describe("posts", () => {
  it("author can create draft/pending but never published", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "posts/p1"), {
        authorUid: ALICE,
        title: "Draft post",
        status: "draft",
        reviewerUid: null,
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "posts/p2"), {
        authorUid: ALICE,
        title: "Straight to prod",
        status: "published",
        reviewerUid: null,
      }),
    );
  });

  it("author cannot self-publish via update; admin can publish", async () => {
    await seed({
      "posts/mine": {
        authorUid: ALICE,
        title: "Mine",
        status: "draft",
        reviewerUid: null,
      },
    });
    await assertFails(
      updateDoc(doc(alice(), "posts/mine"), { status: "published" }),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), "posts/mine"), { status: "pending" }),
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "posts/mine"), { status: "published" }),
    );
  });
});

describe("qa", () => {
  it("create pins likeCount to zero and timestamps to request.time", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "qa/q1"), {
        authorUid: ALICE,
        title: "Tip",
        body: "Use the emulator",
        status: "published",
        likeCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "qa/q2"), {
        authorUid: ALICE,
        title: "Inflated",
        body: "likes",
        status: "published",
        likeCount: 10,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "qa/q3"), {
        authorUid: ALICE,
        title: "Backdated",
        body: "timestamps",
        status: "published",
        likeCount: 0,
        createdAt: new Date("2020-01-01T00:00:00Z"),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("author updates are limited to content fields", async () => {
    await seed({
      "qa/q1": {
        authorUid: ALICE,
        title: "Tip",
        body: "Original",
        status: "published",
        likeCount: 0,
      },
    });
    await assertSucceeds(
      updateDoc(doc(alice(), "qa/q1"), {
        title: "Better tip",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(doc(alice(), "qa/q1"), { likeCount: 5 }));
    await assertFails(updateDoc(doc(alice(), "qa/q1"), { status: "archived" }));
  });
});

describe("polls", () => {
  const zeroedOptions = [
    { id: "a", label: "Option A", voteCount: 0 },
    { id: "b", label: "Option B", voteCount: 0 },
  ];
  const validPoll = {
    authorUid: ALICE,
    title: "Favorite stack?",
    status: "published",
    voterCount: 0,
    likeCount: 0,
    options: zeroedOptions,
  };

  it("create requires zeroed voterCount and per-option voteCounts", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "polls/p1"), {
        ...validPoll,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "polls/p2"), {
        ...validPoll,
        options: [zeroedOptions[0], { id: "b", label: "B", voteCount: 5 }],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "polls/p3"), {
        ...validPoll,
        voterCount: 3,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("ballots are visible only to the voter and never client-writable", async () => {
    await seed({
      "polls/poll1": { ...validPoll, authorUid: BOB, voterCount: 1 },
      [`polls/poll1/votes/${ALICE}`]: { optionId: "a" },
    });
    await assertSucceeds(getDoc(doc(alice(), `polls/poll1/votes/${ALICE}`)));
    // Even the poll author cannot see who voted for what.
    await assertFails(getDoc(doc(bob(), `polls/poll1/votes/${ALICE}`)));
    await assertFails(
      setDoc(doc(alice(), `polls/poll1/votes/${ALICE}`), { optionId: "b" }),
    );
  });

  it("owner cannot rewrite options (embedded counters) after publish", async () => {
    await seed({ "polls/mine": validPoll });
    await assertSucceeds(
      updateDoc(doc(alice(), "polls/mine"), {
        title: "Renamed",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(alice(), "polls/mine"), {
        options: [{ id: "a", label: "Option A", voteCount: 0 }],
      }),
    );
  });
});

describe("feedback", () => {
  const submission = {
    authorUid: ALICE,
    status: "new",
    body: "The RSVP button is broken on mobile",
  };

  it("signed-in user can submit; body length and initial status are enforced", async () => {
    await assertSucceeds(setDoc(doc(alice(), "feedback/f1"), submission));
    await assertFails(
      setDoc(doc(alice(), "feedback/f2"), { ...submission, body: "abc" }),
    );
    await assertFails(
      setDoc(doc(alice(), "feedback/f3"), { ...submission, status: "read" }),
    );
  });

  it("only admin/editor can read — not even the author", async () => {
    await seed({ "feedback/f1": submission });
    await assertFails(getDoc(doc(alice(), "feedback/f1")));
    await assertSucceeds(getDoc(doc(editor(), "feedback/f1")));
  });

  it("editors triage but cannot archive or rewrite the submission", async () => {
    await seed({ "feedback/f1": submission });
    await assertSucceeds(
      updateDoc(doc(editor(), "feedback/f1"), {
        status: "read",
        reviewerUid: EDITOR,
        reviewedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(editor(), "feedback/f1"), { status: "archived" }),
    );
    await assertFails(
      updateDoc(doc(editor(), "feedback/f1"), { body: "tampered" }),
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "feedback/f1"), { status: "archived" }),
    );
  });
});

describe("server-only collections", () => {
  it("mail and errorLogs reject client writes even from admins", async () => {
    await assertFails(
      setDoc(doc(admin(), "mail/m1"), { to: "x@example.com" }),
    );
    await assertFails(
      setDoc(doc(admin(), "errorLogs/log2"), { message: "fake" }),
    );
  });

  it("errorLogs are readable by admin only", async () => {
    await seed({ "errorLogs/log1": { message: "boom" } });
    await assertSucceeds(getDoc(doc(admin(), "errorLogs/log1")));
    await assertFails(getDoc(doc(alice(), "errorLogs/log1")));
  });

  it("sitePages are public-read but never client-writable", async () => {
    await seed({ "sitePages/about": { title: "About JTPA" } });
    await assertSucceeds(getDoc(doc(anon(), "sitePages/about")));
    await assertFails(
      setDoc(doc(admin(), "sitePages/about"), { title: "Defaced" }),
    );
  });
});
