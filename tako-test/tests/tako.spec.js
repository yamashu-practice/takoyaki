import { test, expect } from '@playwright/test';

test.describe('たこ焼き時間割・受注状況管理カウンターのテスト', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('file://' + process.cwd() + '/index.html');
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        // 1. テストモードのラジオボタンをチェック
        await page.locator('#env-testmode').check();
        await page.waitForSelector('#test-time-control', { state: 'visible' });

        // 2. ★超重要：明示的にドロップダウンで「11:00」を選び直すイベントを発生させる
        // これにより、HTML側の updateVirtualTime() が走り、内部変数とタイムスロットが完全に11:00に同期します
        await page.locator('#virtual-time-select').selectOption('11:00');
    });


    test('初期表示の確認', async ({ page }) => {
        // タイトルの確認
        await expect(page).toHaveTitle('たこ焼き時間割・受注状況管理カウンター');
        await expect(page.locator('h1')).toHaveText('🐙 たこ焼き時間割・受注状況管理カウンター');

        // 集計エリアの初期値がすべて0であることを確認
        await expect(page.locator('#total-orders-display')).toHaveText('0');
        await expect(page.locator('#served-orders-display')).toHaveText('0');
        await expect(page.locator('#needed-production-display')).toHaveText('0');
    });

    test('新規受注入力の正常系テスト（分割なしアサイン）', async ({ page }) => {
        // 仮想時刻を「11:00」に設定
        await page.locator('#virtual-time-select').selectOption('11:00');

        // 「新規受注入力」ボタンをクリックしてモーダルを開く
        await page.locator('.order-btn').click();
        await expect(page.locator('#modal-overlay')).toBeVisible();

        // 数量「3舟」と名前を入力
        await page.locator('#order-qty').fill('3');
        await page.locator('#order-memo').fill('テスト太郎様');

        // モーダル内のOKボタンをクリック
        await page.locator('.modal-submit').click();

        // モーダルが閉じたことを確認
        await expect(page.locator('#modal-overlay')).toBeHidden();

        // 11:00枠（current-row）に注文カード「#001 (3舟)」とメモが追加されているか確認
        const currentTimeRow = page.locator('tr.current-row');
        await expect(currentTimeRow).toContainText('#001');
        await expect(currentTimeRow).toContainText('(3舟)');
        await expect(currentTimeRow).toContainText('テスト太郎様');

        // 集計表示の更新確認
        await expect(page.locator('#total-orders-display')).toHaveText('3');
        await expect(page.locator('#needed-production-display')).toHaveText('3');
    });

    test('注文カードのステータス操作（提供済への変更・戻し）', async ({ page }) => {
        // 11:00に注文を1件登録
        await page.locator('#virtual-time-select').selectOption('11:00');
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('2');
        await page.locator('.modal-submit').click();

        // 「提供済」ボタンをクリック
        // confirmダイアログ（ブラウザの確認ポップアップ）を自動で「OK」と承認する設定
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('注文 #001 （2舟） を「提供済」にしてもよろしいですか？');
            await dialog.accept();
        });
        await page.locator('.order-card button:has-text("提供済")').click();

        // カードが提供済スタイル（.served）に変わったか確認
        await expect(page.locator('.order-card.served')).toBeVisible();

        // 集計表示の更新確認（提供済: 2, 要生産数: 0）
        await expect(page.locator('#served-orders-display')).toHaveText('2');
        await expect(page.locator('#needed-production-display')).toHaveText('0');

        // 「未済へ」ボタンをクリックして元に戻せるか確認
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('注文 #001 を「未済（未提供）」に戻してもよろしいですか？');
            await dialog.accept();
        });
        await page.locator('.order-card button:has-text("未済へ")').click();

        // スタイルが未提供に戻ったか確認
        await expect(page.locator('.order-card.served')).toBeHidden();
    });

    test('生産可能数（キャパ）の変更テスト', async ({ page }) => {
        // 11:00枠（最初の行とする）のインプット要素を取得
        const capInput = page.locator('#cap-input-0');

        // 生産可能数を「15」に変更して「確定」ボタンをクリック
        await capInput.fill('15');
        // inputの隣にある確定ボタンをクリック
        await page.locator('tr').nth(1).locator('.confirm-btn').click();

        // 残り受付可数の表示が「受付可: 15 舟」に更新されているか確認
        const availDisplay = page.locator('tr').nth(1).locator('.avail-capacity-display');
        await expect(availDisplay).toContainText('受付可: 15 舟');
    });

    test('エラーハンドリング（数量に不正な値を入力した場合）', async ({ page }) => {
        await page.locator('.order-btn').click();

        // 数量に「0」を入力
        await page.locator('#order-qty').fill('0');

        // alertダイアログが出現することを確認し、閉じる
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('数量には1以上の正しい数値を入力してください');
            await dialog.dismiss();
        });

        await page.locator('.modal-submit').click();

        // モーダルが閉じずに開いたままであることを確認
        await expect(page.locator('#modal-overlay')).toBeVisible();
    });

    test('データの全リセットテスト', async ({ page }) => {
        // 事前に1件注文を追加
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('5');
        await page.locator('.modal-submit').click();

        // ★修正：出現する2回のダイアログを順番に処理する
        let dialogCount = 0;
        page.on('dialog', async dialog => {
            dialogCount++;
            if (dialogCount === 1) {
                // 1回目：confirm("...! よろしいですか?") に対するOK
                expect(dialog.message()).toContain('すべてのデータが初期化されます');
                await dialog.accept();
            } else if (dialogCount === 2) {
                // 2回目：alert("初期化しました。") に対するOK
                expect(dialog.message()).toContain('初期化しました');
                await dialog.accept();
            }
        });

        // 「データをすべてリセット」ボタンをクリック
        await page.locator('.reset-btn').click();

        // 総受注数が0に戻り、モードが本番モード（デフォルト）に戻っているか確認
        await expect(page.locator('#total-orders-display')).toHaveText('0');
        await expect(page.locator('#env-production')).toBeChecked();
    });

    // ==========================================
    // 1. 受注数量 (qty) の境界値・異常系C1テスト
    // ==========================================

    test('注文数量の境界値：0以下はエラーになること（Invalidの下限境界）', async ({ page }) => {
        await page.locator('.order-btn').click();

        // 0のテスト
        await page.locator('#order-qty').fill('0');
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('数量には1以上の正しい数値を入力してください');
            await dialog.dismiss();
        });
        await page.locator('.modal-submit').click();
        await expect(page.locator('#modal-overlay')).toBeVisible(); // モーダルが閉じない

        // マイナス（-1）のテスト
        await page.locator('#order-qty').fill('-1');
        page.once('dialog', async dialog => {
            await dialog.dismiss();
        });
        await page.locator('.modal-submit').click();
        await expect(page.locator('#modal-overlay')).toBeVisible();
    });

    test('注文数量の境界値：1は正常に受け付けられること（Validの下限境界）', async ({ page }) => {
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('1'); // 最小の有効値
        await page.locator('#order-memo').fill('境界値太郎');
        await page.locator('.modal-submit').click();

        // モーダルが閉じ、11:00枠に1舟登録されていること
        await expect(page.locator('#modal-overlay')).toBeHidden();
        await expect(page.locator('tr.current-row')).toContainText('(1舟)');
    });

    // ==========================================
    // 2. 生産可能数 (キャパ) の境界値・C1テスト
    // ==========================================

    test('キャパ変更の境界値：空欄や不正値はエラー、0や大きな値は許可されること', async ({ page }) => {
        const capInput = page.locator('#cap-input-0');
        const confirmBtn = page.locator('tr').nth(1).locator('.confirm-btn');

        // 異常系：マイナス値を入力した場合
        await capInput.fill('-5');
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('生産可能数には0以上の数値を入力してください。');
            await dialog.accept();
        });
        await confirmBtn.click();

        // 境界値：0を入力した場合（キャパ0のシチュエーション）
        await capInput.fill('0');
        await confirmBtn.click();
        await expect(page.locator('tr').nth(1).locator('.avail-capacity-display')).toContainText('満');

        // 正常系の上限：大きな値を設定した場合
        await capInput.fill('100');
        await confirmBtn.click();
        await expect(page.locator('tr').nth(1).locator('.avail-capacity-display')).toContainText('受付可: 100 舟');
    });

    // ==========================================
    // 3. 自動分割アサイン（大口注文）のC1分岐網羅
    // ==========================================

    test('自動分割：キャパをちょうど使い切る注文（境界値：溢れない最大値）', async ({ page }) => {
        // 11:00枠の初期キャパは10とする
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('10'); // キャパぴったり
        await page.locator('#order-memo').fill('ぴったり注文');
        await page.locator('.modal-submit').click();

        // 11:00枠（current-row）のみにカードがあり、次の行（11:30）には無いことを確認
        const row1100 = page.locator('tr').nth(1);
        const row1130 = page.locator('tr').nth(2);

        await expect(row1100).toContainText('#001');
        await expect(row1130).not.toContainText('#001');
        await expect(row1100.locator('.avail-capacity-display')).toContainText('満');
    });

    test('自動分割：キャパを1つだけ超える注文（境界値：次の枠へ1舟だけ溢れる分岐）', async ({ page }) => {
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('11'); // キャパ10に対して11を入力（1つ溢れる）
        await page.locator('#order-memo').fill('溢れテスト');
        await page.locator('.modal-submit').click();

        const row1100 = page.locator('tr').nth(1);
        const row1130 = page.locator('tr').nth(2);

        // 11:00枠には「10舟」、11:30枠に「1舟」に自動分割されているかをC1検証
        await expect(row1100).toContainText('#001');
        await expect(row1100).toContainText('(10舟)');

        await expect(row1130).toContainText('#001');
        await expect(row1130).toContainText('(1舟)');

        // それぞれの残り受付可数の変化を検証
        await expect(row1100.locator('.avail-capacity-display')).toContainText('満');
        await expect(row1130.locator('.avail-capacity-display')).toContainText('受付可: 9 舟'); // 10 - 1 = 9
    });

    test('自動分割：複数枠（2枠以上）に跨って溢れる超大口注文のループ分岐テスト', async ({ page }) => {
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('25'); // 11:00(10舟) -> 11:30(10舟) -> 12:00(5舟) 
        await page.locator('#order-memo').fill('超大口');
        await page.locator('.modal-submit').click();

        // 3つの時間帯の行をそれぞれ検証
        await expect(page.locator('tr').nth(1)).toContainText('(10舟)'); // 11:00
        await expect(page.locator('tr').nth(2)).toContainText('(10舟)'); // 11:30
        await expect(page.locator('tr').nth(3)).toContainText('(5舟)');  // 12:00

        // 集計表示は分割されず合算されていること
        await expect(page.locator('#total-orders-display')).toHaveText('25');
    });

    // ==========================================
    // 4. 動的ダイアログ文言のC1分岐テスト
    // ==========================================

    test('ダイアログ確認：提供済にする際、ポップアップにID・舟数・名前が正しく表示されるか', async ({ page }) => {
        // 注文を入れる
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('3');
        await page.locator('#order-memo').fill('検証次郎');
        await page.locator('.modal-submit').click();

        // 「提供済」クリック時の文言分岐テスト
        page.once('dialog', async dialog => {
            // HTML側のJSで組み立てられる確認文言を厳密にアサーション
            const msg = dialog.message();
            expect(msg).toContain('注文 #001');
            expect(msg).toContain('3舟');
            expect(msg).toContain('を「提供済」にしてもよろしいですか？');
            await dialog.accept();
        });
        await page.locator('.order-card button:has-text("提供済")').click();
    });

    // ==========================================
    // 5. カバレッジ100%のための未網羅ルートテスト
    // ==========================================

    test('未網羅C1：注文カードを「未済へ」に戻す操作をキャンセルした場合', async ({ page }) => {
        // 事前に提供済の注文を1件作る
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('2');
        await page.locator('.modal-submit').click();
        page.once('dialog', async dialog => { await dialog.accept(); });
        await page.locator('.order-card button:has-text("提供済")').click();
        await expect(page.locator('.order-card.served')).toBeVisible();

        // ★未済へ戻すダイアログを「キャンセル（dismiss）」する
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('「未済（未提供）」に戻してもよろしいですか？');
            await dialog.dismiss(); // キャンセルを選択
        });
        await page.locator('.order-card button:has-text("未済へ")').click();

        // キャンセルしたため、カードは「提供済（.served）」のままであることを検証
        await expect(page.locator('.order-card.served')).toBeVisible();
        await expect(page.locator('#served-orders-display')).toHaveText('2');
    });

    test('未網羅C1：キャパシティ入力が「空欄」または「数字以外」の場合のガード節', async ({ page }) => {
        const capInput = page.locator('#cap-input-0');
        const confirmBtn = page.locator('tr').nth(1).locator('.confirm-btn');

        // 空欄を入力して確定
        await capInput.fill('');
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('生産可能数には0以上の数値を入力してください');
            await dialog.accept();
        });
        await confirmBtn.click();

        // 文字（あ）を入力して確定
        // 1. ブラウザのJavaScriptの力を使って、強制的に「あ」という文字列を書き込む
        await capInput.evaluate(el => el.value = 'あ');

        // 2. 「確定」ボタンを押した際、HTML側の isNaN(val) が正しく発動するか検証
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('生産可能数には0以上の数値を入力してください');
            await dialog.accept();
        });
        await confirmBtn.click();

    });

    test('未網羅C1：本番モードへの切り戻しによるUIおよび時間軸の同期確認', async ({ page }) => {
        // 1. 一度テストモードにして11:00に設定されている状態
        await expect(page.locator('#test-time-control')).toBeVisible();

        // 2. 「本番モード」のラジオボタンをチェック
        await page.locator('#env-production').check();

        // 3. テスト用の時間操作パネルが非表示になることを検証
        await expect(page.locator('#test-time-control')).toBeHidden();

        // 4. 本番モードに戻ると、現在のリアル時間（実行中のPC時間）の枠に「current-row」クラスが付与される
        // ※ 実行時間によって行が変わるため、いずれかの行に current-row が1つだけ存在することを確認
        await expect(page.locator('tr.current-row')).toHaveCount(1);
    });

    test('未網羅C1：全時間帯の総キャパシティを上回る限界突破注文時の挙動', async ({ page }) => {
        await page.locator('.order-btn').click();
        await page.locator('#order-qty').fill('500');
        await page.locator('#order-memo').fill('限界突破');

        // 正しく出現するアラートをキャッチして承諾（OK）する
        let isAlertSeen = false;
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('生産上限エラー');
            isAlertSeen = true;
            await dialog.accept();
        });

        await page.locator('.modal-submit').click();

        // アラートが視認され、登録されずに総受注数が0であることを検証
        expect(isAlertSeen).toBe(true);
        await expect(page.locator('#total-orders-display')).toHaveText('0');
    });

});
