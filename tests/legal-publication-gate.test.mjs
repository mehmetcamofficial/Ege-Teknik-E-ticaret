import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCandidates, candidateFromSource, VALID_SLUGS } from "../scripts/verify-legal-publication.mjs";

test("exact source-to-candidate transformation is stable for all three documents", () => {
  for(const slug of VALID_SLUGS) {
    const src=readFileSync("docs/legal-drafts/"+slug+".md","utf8");
    const candidate=readFileSync("docs/legal-publication-candidates/"+slug+".md","utf8");
    assert.equal(candidate,candidateFromSource(slug,src));
    assert.ok(!/RELEASE CANDIDATE|DOĞRULAMA BEKLİYOR|Sürüm notu:/.test(candidate));
  }
});

test("structural validation passes but is explicitly NOT publication approval", () => {
  assert.deepEqual(auditCandidates({structuralOnly:true}).failures,[]);
  const result=auditCandidates();
  assert.equal(result.ok,false);
  assert.ok(result.failures.includes("RELEASE_STATUS_NOT_APPROVED"));
  assert.ok(result.failures.includes("UNRESOLVED_GATE:ETBIS_REGISTRATION"));
  assert.ok(result.failures.includes("UNRESOLVED_GATE:INSTALLATION_SCOPE_4M"));
  assert.ok(result.failures.includes("UNRESOLVED_GATE:LEGAL_COUNSEL_APPROVAL"));
});

test("a changed customer candidate is rejected against its source", () => {
  const root=mkdtempSync(join(tmpdir(),"legal-publish-gate-"));
  try {
    mkdirSync(join(root,"docs/legal-drafts"),{recursive:true});
    mkdirSync(join(root,"docs/legal-publication-candidates"),{recursive:true});
    for(const slug of VALID_SLUGS) {
      const original="docs/legal-drafts/"+slug+".md";
      const candidate="docs/legal-publication-candidates/"+slug+".md";
      writeFileSync(join(root,original),readFileSync(original));
      writeFileSync(join(root,candidate),readFileSync(candidate));
    }
    writeFileSync(join(root,"docs/legal-publication-candidates/release-gates.json"),readFileSync("docs/legal-publication-candidates/release-gates.json"));
    const changed=join(root,"docs/legal-publication-candidates/kvkk.md");
    writeFileSync(changed,readFileSync(changed,"utf8")+"\n[DOĞRULAMA BEKLİYOR: TEST]\n");
    const result=auditCandidates({root,structuralOnly:true});
    assert.ok(result.failures.includes("kvkk:SOURCE_CANDIDATE_DRIFT"));
    assert.ok(result.failures.includes("kvkk:INTERNAL_MARKER_PRESENT"));
  } finally { rmSync(root,{recursive:true,force:true}); }
});
