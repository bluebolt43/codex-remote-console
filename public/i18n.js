export const settingsKey = "codex-remote-console-settings";

export const localeByLanguage = { en: "en", "zh-Hant": "zh-TW", ja: "ja-JP", ko: "ko-KR" };
export const speechLocaleByLanguage = { en: "en-US", "zh-Hant": "zh-TW", ja: "ja-JP", ko: "ko-KR" };

export function readSettings() {
  try {
    return { language: "zh-Hant", customPrompt: "continue", ...JSON.parse(localStorage.getItem(settingsKey)) };
  } catch {
    return { language: "zh-Hant", customPrompt: "continue" };
  }
}

export function authPageLanguage() {
  const savedLanguage = (() => {
    try {
      return JSON.parse(localStorage.getItem(settingsKey))?.language;
    } catch {
      return null;
    }
  })();
  if (savedLanguage && localeByLanguage[savedLanguage]) return savedLanguage;
  const browserLanguage = navigator.language.toLowerCase();
  if (browserLanguage.startsWith("zh")) return "zh-Hant";
  if (browserLanguage.startsWith("ja")) return "ja";
  if (browserLanguage.startsWith("ko")) return "ko";
  return "en";
}

export const appTranslations = {
  en: { remoteSession: "remote session", readyInstructions: "Ready for instructions", emptyHint: "Enter a task and Codex will work in the current project.", stop: "Stop", send: "Send ↑", working: "working", ready: "ready", you: "YOU", activity: "ACTIVITY", image: "[image]", images: (count) => `[${count} images]`, approvalRequired: "Approval required", approvalFallback: "Codex requests approval", yes: "Yes", yesHint: "Allow once", alwaysYes: "Yes, never ask again", alwaysYesHint: "Do not ask again in this session", no: "No", noHint: "Decline", removeImage: "Remove image", imageAlt: (index) => `Image ${index}`, generatedImage: "Generated image", imageLoadFailed: "Image could not be loaded", viewPrompt: "View prompt", default: "Default", addImage: "Add image", voiceInput: "Voice input", stopListening: "Stop listening", voiceError: "Voice input failed", files: "Files", workspaceFiles: "Workspace files", emptyFolder: "This folder is empty", folderLoadFailed: "Could not load files" },
  "zh-Hant": { remoteSession: "遠端 Session", readyInstructions: "等待指令", emptyHint: "輸入工作內容，Codex 會在目前專案中執行。", stop: "中斷", send: "送出 ↑", working: "執行中", ready: "就緒", you: "你", activity: "活動", image: "[圖片]", images: (count) => `[${count} 張圖片]`, approvalRequired: "需要授權", approvalFallback: "Codex 要求授權", yes: "是", yesHint: "僅允許這一次", alwaysYes: "是，不再詢問", alwaysYesHint: "目前 Session 不再詢問", no: "否", noHint: "拒絕", removeImage: "移除圖片", imageAlt: (index) => `圖片 ${index}`, generatedImage: "生成圖片", imageLoadFailed: "圖片無法載入", viewPrompt: "查看 Prompt", default: "預設", addImage: "新增圖片", voiceInput: "語音輸入", stopListening: "停止聆聽", voiceError: "語音輸入失敗", files: "檔案", workspaceFiles: "工作目錄檔案", emptyFolder: "此資料夾是空的", folderLoadFailed: "無法載入檔案" },
  ja: { remoteSession: "リモートセッション", readyInstructions: "指示を待っています", emptyHint: "タスクを入力すると、Codex が現在のプロジェクトで作業します。", stop: "停止", send: "送信 ↑", working: "実行中", ready: "準備完了", you: "あなた", activity: "アクティビティ", image: "[画像]", images: (count) => `[画像 ${count} 枚]`, approvalRequired: "承認が必要です", approvalFallback: "Codex が承認を求めています", yes: "はい", yesHint: "今回のみ許可", alwaysYes: "はい、今後確認しない", alwaysYesHint: "このセッションでは確認しない", no: "いいえ", noHint: "拒否", removeImage: "画像を削除", imageAlt: (index) => `画像 ${index}`, generatedImage: "生成画像", imageLoadFailed: "画像を読み込めません", viewPrompt: "プロンプトを表示", default: "デフォルト", addImage: "画像を追加", voiceInput: "音声入力", stopListening: "音声入力を停止", voiceError: "音声入力に失敗しました", files: "ファイル", workspaceFiles: "ワークスペースのファイル", emptyFolder: "このフォルダーは空です", folderLoadFailed: "ファイルを読み込めません" },
  ko: { remoteSession: "원격 세션", readyInstructions: "지시를 기다리는 중", emptyHint: "작업을 입력하면 Codex가 현재 프로젝트에서 작업합니다.", stop: "중지", send: "보내기 ↑", working: "작업 중", ready: "준비됨", you: "나", activity: "활동", image: "[이미지]", images: (count) => `[이미지 ${count}개]`, approvalRequired: "승인이 필요합니다", approvalFallback: "Codex가 승인을 요청합니다", yes: "예", yesHint: "이번만 허용", alwaysYes: "예, 다시 묻지 않기", alwaysYesHint: "이 세션에서는 다시 묻지 않기", no: "아니요", noHint: "거부", removeImage: "이미지 삭제", imageAlt: (index) => `이미지 ${index}`, generatedImage: "생성된 이미지", imageLoadFailed: "이미지를 불러올 수 없습니다", viewPrompt: "프롬프트 보기", default: "기본값", addImage: "이미지 추가", voiceInput: "음성 입력", stopListening: "음성 입력 중지", voiceError: "음성 입력에 실패했습니다", files: "파일", workspaceFiles: "작업 공간 파일", emptyFolder: "이 폴더는 비어 있습니다", folderLoadFailed: "파일을 불러올 수 없습니다" },
};

export const sessionTranslations = {
  en: { managerSubtitle: "session manager", logout: "Logout", settings: "Settings", newSession: "＋ New", sessions: "Sessions", refresh: "Refresh", chooseWorkspace: "Choose workspace", newFolderName: "New folder name", newFolder: "＋ Folder", cancel: "Cancel", createSession: "Create session", language: "Language", workspaceRoot: "Workspace root", workspaceTodo: "This setting is not supported yet", customButtonText: "Custom button text", lastLogin: "Last successful login", pairedDevices: "Paired devices", activeSessions: "Active login sessions", recentLogins: "Recent login activity", current: "Current", revoke: "Revoke", save: "Save", noActivity: "No activity yet", newSessionTitle: "New session", delete: "Delete", stopBeforeDelete: "Stop this session before deleting it", deleteTitle: "Permanently delete this session", deleteConfirm: (title) => `Permanently delete “${title}”?\n\nThis cannot be undone.`, deleteFailed: "Delete failed", empty: "No sessions yet", saveFailed: "Could not save settings", unknownBrowser: "Unknown browser", unknownOS: "Unknown OS", lanViaRouter: (value) => `LAN via router (${value})`, sessionUnit: "session", success: "Success", failed: "Failed", eventLabels: { pairing: "Device paired", login: "Login", "login-new-address": "Login from new address", "login-blocked": "Login address blocked", "device-revoked": "Device revoked", "session-revoked": "Session revoked" } },
  "zh-Hant": { managerSubtitle: "Session 管理", logout: "登出", settings: "設定", newSession: "＋ 新增", sessions: "Sessions", refresh: "重新整理", chooseWorkspace: "選擇工作目錄", newFolderName: "新資料夾名稱", newFolder: "＋ 資料夾", cancel: "取消", createSession: "建立 Session", language: "語言", workspaceRoot: "Workspace 根目錄", workspaceTodo: "此設定目前暫不支援", customButtonText: "自訂按鈕文字", lastLogin: "最後一次成功登入", pairedDevices: "已配對裝置", activeSessions: "登入中的 Sessions", recentLogins: "最近登入活動", current: "目前使用中", revoke: "撤銷", save: "儲存", noActivity: "尚無活動", newSessionTitle: "新 Session", delete: "刪除", stopBeforeDelete: "請先中斷此 Session", deleteTitle: "永久刪除此 Session", deleteConfirm: (title) => `永久刪除「${title}」？\n\n此動作無法復原。`, deleteFailed: "刪除失敗", empty: "尚未建立 Session", saveFailed: "設定儲存失敗", unknownBrowser: "未知瀏覽器", unknownOS: "未知系統", lanViaRouter: (value) => `經由區網路由器 (${value})`, sessionUnit: "Session", success: "成功", failed: "失敗", eventLabels: { pairing: "裝置配對", login: "登入", "login-new-address": "從新 IP 登入", "login-blocked": "登入 IP 已封鎖", "device-revoked": "裝置已撤銷", "session-revoked": "登入 Session 已撤銷" } },
  ja: { managerSubtitle: "セッション管理", logout: "ログアウト", settings: "設定", newSession: "＋ 新規", sessions: "セッション", refresh: "更新", chooseWorkspace: "ワークスペースを選択", newFolderName: "新しいフォルダー名", newFolder: "＋ フォルダー", cancel: "キャンセル", createSession: "セッションを作成", language: "言語", workspaceRoot: "ワークスペースのルート", workspaceTodo: "この設定は現在サポートされていません", customButtonText: "カスタムボタンのテキスト", lastLogin: "最終ログイン成功", pairedDevices: "ペアリング済みデバイス", activeSessions: "有効なログインセッション", recentLogins: "最近のログイン履歴", current: "現在使用中", revoke: "取り消す", save: "保存", noActivity: "履歴はありません", newSessionTitle: "新しいセッション", delete: "削除", stopBeforeDelete: "削除する前にこのセッションを停止してください", deleteTitle: "このセッションを完全に削除", deleteConfirm: (title) => `「${title}」を完全に削除しますか？\n\nこの操作は元に戻せません。`, deleteFailed: "削除に失敗しました", empty: "セッションはありません", saveFailed: "設定を保存できませんでした", unknownBrowser: "不明なブラウザ", unknownOS: "不明なOS", lanViaRouter: (value) => `LANルーター経由 (${value})`, sessionUnit: "セッション", success: "成功", failed: "失敗", eventLabels: { pairing: "デバイスをペアリング", login: "ログイン", "login-new-address": "新しいIPからログイン", "login-blocked": "ログイン元IPをブロック", "device-revoked": "デバイスを取り消し", "session-revoked": "ログインセッションを取り消し" } },
  ko: { managerSubtitle: "세션 관리", logout: "로그아웃", settings: "설정", newSession: "＋ 새로 만들기", sessions: "세션", refresh: "새로 고침", chooseWorkspace: "작업 공간 선택", newFolderName: "새 폴더 이름", newFolder: "＋ 폴더", cancel: "취소", createSession: "세션 만들기", language: "언어", workspaceRoot: "작업 공간 루트", workspaceTodo: "이 설정은 아직 지원되지 않습니다", customButtonText: "사용자 지정 버튼 텍스트", lastLogin: "마지막 로그인 성공", pairedDevices: "페어링된 기기", activeSessions: "활성 로그인 세션", recentLogins: "최근 로그인 활동", current: "현재 사용 중", revoke: "해제", save: "저장", noActivity: "활동 없음", newSessionTitle: "새 세션", delete: "삭제", stopBeforeDelete: "삭제하기 전에 이 세션을 중지하세요", deleteTitle: "이 세션을 영구 삭제", deleteConfirm: (title) => `“${title}” 세션을 영구 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`, deleteFailed: "삭제하지 못했습니다", empty: "세션이 없습니다", saveFailed: "설정을 저장하지 못했습니다", unknownBrowser: "알 수 없는 브라우저", unknownOS: "알 수 없는 OS", lanViaRouter: (value) => `라우터를 통한 LAN (${value})`, sessionUnit: "세션", success: "성공", failed: "실패", eventLabels: { pairing: "기기 페어링", login: "로그인", "login-new-address": "새 IP에서 로그인", "login-blocked": "로그인 IP 차단", "device-revoked": "기기 해제", "session-revoked": "로그인 세션 해제" } },
};

export const loginTranslations = {
  en: { title: "Sign in", instruction: "Sign in with a paired Passkey.", login: "Sign in with Passkey", pair: "Create a new Passkey" },
  "zh-Hant": { title: "登入", instruction: "使用已配對的 Passkey 登入。", login: "使用 Passkey 登入", pair: "建立新的 Passkey" },
  ja: { title: "ログイン", instruction: "ペアリング済みのPasskeyでログインします。", login: "Passkeyでログイン", pair: "新しいPasskeyを作成" },
  ko: { title: "로그인", instruction: "페어링된 Passkey로 로그인합니다.", login: "Passkey로 로그인", pair: "새 Passkey 만들기" },
};

export const pairTranslations = {
  en: { title: "Pair device", code: "One-time password shown by server.sh pair", create: "Create Passkey" },
  "zh-Hant": { title: "配對裝置", code: "server.sh pair 顯示的一次性密碼", create: "建立 Passkey" },
  ja: { title: "デバイスをペアリング", code: "server.sh pair に表示されたワンタイムパスワード", create: "Passkeyを作成" },
  ko: { title: "기기 페어링", code: "server.sh pair에 표시된 일회용 비밀번호", create: "Passkey 만들기" },
};
