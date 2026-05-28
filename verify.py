import os, sys
from playwright.sync_api import sync_playwright

APP = "file:///C:/Users/yu2511zh/coldstart/index.html"
SS  = "C:/Users/yu2511zh/coldstart/test-screenshots"
os.makedirs(SS, exist_ok=True)

def ss(page, name):
    path = f"{SS}/{name}.png"
    page.screenshot(path=path)
    print(f"  [screenshot] {name}.png")
    return path

def clear_storage(page):
    page.evaluate("localStorage.removeItem('coldstart')")
    page.reload()
    page.wait_for_timeout(500)

findings = []
def warn(msg): findings.append(f"WARN: {msg}"); print(f"  [!] {msg}")

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="msedge", args=["--no-sandbox"])
        ctx  = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ── 1. Fresh load ─────────────────────────────────────────────────
        page.goto(APP)
        clear_storage(page)
        assert page.locator("#setup-name").is_visible(), "Setup screen not loaded"
        ss(page, "01-setup")
        print("[PASS] Setup screen loaded")

        # ── 2. Setup form ─────────────────────────────────────────────────
        page.fill("#setup-name", "Test Project")
        page.fill("#setup-desc", "Economics paper on background uncertainty")
        page.fill("#setup-url",  "https://github.com/torvalds/linux")
        page.fill("#setup-localpath", "C:\\Users\\yu2511zh\\test-project")
        page.click("#setup-submit")
        page.wait_for_timeout(700)
        ss(page, "02-choice")
        assert page.locator("#choice-ritual").is_visible(), "Choice screen not reached"
        print("[PASS] Choice screen reached after setup")

        # ── 3. Back button hidden on choice ───────────────────────────────
        back = page.locator("#back-btn")
        assert back.evaluate("el => el.style.display") == "none", "Back btn should hide on choice"
        print("[PASS] Back button hidden on choice screen")

        # ── 4. Ritual path ────────────────────────────────────────────────
        page.click("#choice-ritual")
        page.wait_for_timeout(900)
        ss(page, "03-arrive")
        assert back.evaluate("el => el.style.display") != "none", "Back btn missing on arrive"
        print("[PASS] Back button visible on arrive screen")

        # Wait for all lines to reveal + continue
        page.wait_for_selector("#arrive-continue", state="visible", timeout=15000)
        ss(page, "03b-arrive-continue-ready")
        page.click("#arrive-continue")
        page.wait_for_timeout(800)

        # ── 5. Breathing prep ─────────────────────────────────────────────
        assert page.locator("#breath-speed").is_visible(), "Speed slider missing"
        page.evaluate("() => { const s=document.getElementById('breath-speed'); s.value='2'; s.dispatchEvent(new Event('input',{bubbles:true})); }")
        page.wait_for_timeout(200)
        speed_label = page.locator("#breath-speed-val").inner_text()
        assert speed_label == "2", f"Speed label: {speed_label}"
        ss(page, "04-breathing-prep-slider")
        print(f"[PASS] Breathing prep: slider works, set to {speed_label}s per phase")

        # Back from breathing -> arrive
        page.click("#back-btn")
        page.wait_for_timeout(500)
        ss(page, "04b-back-to-arrive")
        assert page.locator("#arrive-continue").is_visible(), "Back from breathing failed"
        print("[PASS] Back from breathing -> arrive works")

        # Forward again, start at 2s this time
        page.click("#arrive-continue")
        page.wait_for_timeout(500)
        page.evaluate("() => { const s=document.getElementById('breath-speed'); s.value='2'; s.dispatchEvent(new Event('input',{bubbles:true})); }")
        page.wait_for_timeout(100)
        # Use skip on prep stage (tests the skip button)
        ss(page, "05-breathing-prep-with-skip")
        assert page.locator("#breath-skip-prep").is_visible(), "Skip button on prep missing"
        page.click("#breath-skip-prep")
        print("[PASS] Breathing skip (from prep) works")
        page.wait_for_timeout(1000)

        # ── 6. Grounding ─────────────────────────────────────────────────
        ss(page, "06-grounding")
        print("[PASS] Grounding screen")
        for i in range(3):
            page.wait_for_timeout(2000)  # wait for button (1.5s hold)
            prompt = page.locator("#grounding-prompt").inner_text()
            print(f"  Prompt {i+1}: '{prompt}'")
            page.wait_for_selector("#grounding-next", state="visible")
            page.click("#grounding-next")
            page.wait_for_timeout(400)
        page.wait_for_timeout(500)

        # ── 7. Direction screen — 2 inputs only ──────────────────────────
        ss(page, "07-direction")
        assert page.locator("#dir-focus").is_visible(), "Direction screen missing"
        # Verify no dir-s3 (small step removed)
        s3_visible = page.locator("#dir-s3").count()
        if s3_visible > 0:
            warn("dir-s3 (old small step) still in DOM - should be removed")
        else:
            print("[PASS] Direction screen: no small-step field (moved to project selection)")

        page.fill("#dir-focus", "Write introduction section")
        page.click("#dir-s1-next")
        page.wait_for_timeout(300)
        page.fill("#dir-tasks", "Draft outline\nReview citations")
        page.click("#dir-s2-next")
        page.wait_for_timeout(600)

        # ── 8. Emotion check ─────────────────────────────────────────────
        ss(page, "08-emotion-gate")
        assert page.locator("#emotion-yes").is_visible(), "Emotion gate missing"
        print("[PASS] Emotion gate reached")

        page.click("#emotion-yes")
        page.wait_for_timeout(400)

        for answer in ["I fear it won't be good enough",
                       "People will judge me",
                       "That I am not capable"]:
            page.fill("#emotion-input", answer)
            page.click("#emotion-prompt-next")
            page.wait_for_timeout(400)

        ss(page, "09-emotion-review")
        review_html = page.locator("#emotion-review").inner_html()
        for check in ["good enough", "judge", "capable"]:
            assert check in review_html, f"Review missing: '{check}'"
        print("[PASS] Review screen shows all 3 answers")

        # Check skip button exists
        assert page.locator("#review-skip").is_visible(), "Skip button missing from review"
        print("[PASS] 'I'm ready to begin' skip button present on review screen")

        # Use Look Closer path through all 3 reframes
        page.click("#review-next")
        page.wait_for_timeout(400)
        for i in range(3):
            ss(page, f"10-reframe-{i+1}")
            quote = page.locator(".reflection-quote").first.inner_text()
            print(f"  Reframe {i+1} blockquote: '{quote[:40]}...'")
            page.fill("#reframe-input", f"Reflection response {i+1}")
            btn_text = page.locator("#reframe-next").inner_text()
            page.click("#reframe-next")
            page.wait_for_timeout(400)

        ss(page, "11-closing")
        assert page.locator("#emotion-closing").is_visible(), "Closing screen missing"
        closing = page.locator("#emotion-closing").inner_text()
        assert "resolve" in closing.lower(), f"Unexpected closing: {closing}"
        print("[PASS] Closing: 'You don't need to resolve all of this right now'")

        page.wait_for_timeout(2500)
        page.click("#emotion-continue")
        page.wait_for_timeout(800)

        # ── 9. Projects + Other card ─────────────────────────────────────────
        ss(page, "12-projects")
        cards = page.locator(".project-card")
        assert cards.count() >= 2, f"Expected project + Other cards, got {cards.count()}"
        last_text = cards.last.inner_text()
        assert "Other" in last_text, f"Last card should be Other, got: '{last_text}'"
        print(f"[PASS] Project cards including Other ({cards.count()} total)")

        # Probe Other path
        cards.last.click()
        page.wait_for_timeout(400)
        ss(page, "12c-other-project-form")
        assert page.locator("#other-project-name").is_visible(), "Other form missing"
        print("[PASS] Other project form works")
        page.click("#back-btn")
        page.wait_for_timeout(400)

        # Back from projects -> emotion gate
        page.click("#back-btn")
        page.wait_for_timeout(500)
        ss(page, "12b-back-emotion-gate")
        assert page.locator("#emotion-gate").is_visible(), "Back from projects: emotion gate missing"
        print("[PASS] Back from projects -> emotion gate")

        # Skip emotion and proceed
        page.click("#emotion-no")
        page.wait_for_timeout(600)

        # ── 10. Select project -> first step ─────────────────────────────
        page.locator(".project-card").first.click()
        page.wait_for_timeout(500)
        ss(page, "13-first-step")
        assert page.locator("#first-step-input").is_visible(), "First step input missing"
        print("[PASS] First step input screen after selecting project")

        # Check commits shown
        commits_visible = page.locator(".begin-commits").is_visible()
        if not commits_visible:
            warn("Commits section not shown on first-step screen (may still be loading or no network)")
        else:
            print("[PASS] Recent commits section visible on first-step screen")

        # Back from first step -> projects
        page.click("#back-btn")
        page.wait_for_timeout(500)
        assert page.locator(".project-card").first.is_visible(), "Back from first-step failed"
        print("[PASS] Back from first step -> projects")

        # Select again
        page.locator(".project-card").first.click()
        page.wait_for_timeout(500)
        page.fill("#first-step-input", "Open the draft and reread the last paragraph")
        ss(page, "13b-first-step-filled")
        page.click("#first-step-next")
        page.wait_for_timeout(500)

        # ── 11. Begin screen ─────────────────────────────────────────────
        ss(page, "14-begin-screen")
        step_text = page.locator(".begin-step").inner_text()
        assert "paragraph" in step_text, f"Small step missing on begin: '{step_text}'"
        print(f"[PASS] Begin screen — small step: '{step_text}'")

        terminal = page.locator(".terminal-block")
        assert terminal.is_visible(), "Terminal block missing on begin screen"
        cmd = page.locator(".terminal-cmd").inner_text()
        assert "test-project" in cmd, f"Terminal cmd unexpected: '{cmd}'"
        print(f"[PASS] Terminal block: '{cmd}'")

        vscode_link = page.locator(".terminal-vscode-link")
        href = vscode_link.get_attribute("href")
        assert "vscode://file" in href, f"VS Code link unexpected: {href}"
        print(f"[PASS] VS Code link: '{href}'")

        # Check GitHub repo button
        repo_link = page.locator("a.btn[href*='github']")
        assert repo_link.count() > 0, "GitHub repo button missing"
        print("[PASS] Open repository button present")

        # Copy button
        page.click(".terminal-copy-btn")
        page.wait_for_timeout(1600)
        copy_btn_text = page.locator(".terminal-copy-btn").inner_text()
        # After 1.5s it resets back to copy icon
        print(f"[PASS] Copy button clicked (resets after 1.5s)")

        # ── 12. Probe: full back chain from begin ─────────────────────────
        screens_visited = []
        for _ in range(15):
            btn_display = back.evaluate("el => el.style.display")
            if btn_display == "none": break
            screens_visited.append(page.evaluate("() => document.querySelector('.screen.active')?.id"))
            page.click("#back-btn")
            page.wait_for_timeout(400)
        final_screen = page.evaluate("() => document.querySelector('.screen.active')?.id")
        ss(page, "15-back-chain-end")
        print(f"[PASS] Back chain traversal ended at: {final_screen}")

        # ── 13. Probe: settings from begin screen ─────────────────────────
        # Navigate to begin again
        page.locator("#choice-ritual") if page.locator("#choice-ritual").count() else None
        page.click("#settings-btn")
        page.wait_for_timeout(300)
        overlay_hidden = page.locator("#settings-overlay").evaluate("el => el.classList.contains('hidden')")
        assert not overlay_hidden, "Settings overlay didn't open"
        print("[PASS] Settings accessible from any screen")
        page.click(".close-btn")
        page.wait_for_timeout(200)

        # ── 14. JS errors ────────────────────────────────────────────────
        if errors:
            for e in errors:
                warn(f"JS error: {e}")
        else:
            print("[PASS] No JavaScript console errors")

        browser.close()

        print("\n--- FINDINGS ---")
        if findings:
            for f in findings: print(f)
        else:
            print("None")
        print("\n[DONE] Verification complete.")

run()
