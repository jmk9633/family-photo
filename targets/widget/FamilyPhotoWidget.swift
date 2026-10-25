// 홈 화면 위젯 (개발 8-1, F-NGOJFO, 10/25 결정)
//
// - 크기: 큰 것(사진을 크게, 와이어프레임 '쉬운 모드 · 폰 홈 화면 위젯')과 중간(사진 왼쪽, 글 오른쪽) 두 가지.
// - 보여주는 것: 가장 최근 새 묶음의 첫 장 + '새 사진 N장'(그 묶음의 장 수) + 제목 + 'OO이 보냄 · 오늘'.
//   새 사진이 없으면 최근 사진을 보여주고 '새 사진' 표시는 숨긴다. 고르는 규칙은 DB widget_feed(0014)가 정한다.
// - 위젯이 30분쯤마다 스스로 서버(Edge Function `widget`)에 물어본다. 앱을 열거나 사진을 보면 앱이 바로 다시 그리게 한다.
// - 위젯은 앱의 로그인 정보를 쓰지 않고, 앱이 공용 칸(App Group)에 둔 '위젯 열쇠'만 쓴다.
// - 위젯이 사진을 보여주는 것은 '봤어요'도 활동도 아니다 (서버가 아무것도 기록하지 않는다).
// - 누르면 앱 홈으로 간다 (familyphoto://widget → 앱의 +native-intent.tsx·features/widget).
// - 인터넷이 안 되면 마지막으로 받은 사진을 그대로 보여준다 (공용 칸에 저장). 다른 계정의 사진은 보여주지 않는다.
// - 8-2: iOS 26부터는 새 사진이 오면 서버가 애플을 통해 '다시 그려' 신호를 보낸다 (WidgetKit 푸시, 알림 허용과 상관없음).
//   애플이 준 신호 주소는 `FamilyPhotoPushHandler`가 공용 칸에 두고, 위젯이 서버에 물어볼 때마다 함께 보낸다.
//   iOS 26보다 오래된 폰에는 이 부분이 없고 30분 확인만 한다.
//
// 문구는 위젯이 앱의 src/copy/ko.ts를 읽을 수 없어 아래 `Copy`에 모은다 (CLAUDE.md 화면 규칙의 예외).
// 글씨는 쉬운 화면 기준(본문 18 이상)을 지킨다.

import SwiftUI
import UIKit
import WidgetKit

private let appGroup = "group.com.jmk9633.familyphoto"
private let accent = Color(red: 194.0 / 255, green: 65.0 / 255, blue: 12.0 / 255)
private let textColor = Color(red: 26.0 / 255, green: 26.0 / 255, blue: 26.0 / 255)
private let openURL = URL(string: "familyphoto://widget")!
private let refreshMinutes: Double = 30
private let retryMinutes: Double = 15

private enum Copy {
  static let appName = "가족 사진"
  static let description = "가족이 보낸 최근 사진을 홈 화면에서 바로 봐요."
  static let connect = "가족과 연결해 주세요"
  static let empty = "가족이 사진을 보내면 여기에 보여요"
  static let unavailable = "앱을 열면 사진을 다시 불러와요"
  static let today = "오늘"
  static let yesterday = "어제"
  static func newCount(_ n: Int) -> String { "새 사진 \(n)장" }
  static func day(_ m: Int, _ d: Int) -> String { "\(m)월 \(d)일" }
  static func dayWithYear(_ y: Int, _ m: Int, _ d: Int) -> String { "\(y)년 \(m)월 \(d)일" }
}

// MARK: - 데이터

enum WidgetState: String, Codable {
  case ok, connect, empty, unavailable
}

struct Snapshot: Codable {
  var state: WidgetState
  var isNew: Bool = false
  var count: Int = 0
  var title: String? = nil
  var sender: String? = nil
  var createdAt: Date? = nil
}

struct PhotoEntry: TimelineEntry {
  let date: Date
  let snap: Snapshot
  let image: UIImage?
}

/// Edge Function `widget`의 응답
private struct FeedResponse: Decodable {
  let status: String
  let isNew: Bool?
  let count: Int?
  let title: String?
  let sender: String?
  let createdAt: String?
  let imageUrl: String?
}

/// DB 시각 문자열('2026-10-25T01:02:03.123456+00:00')을 Date로. 소수점 아래 자릿수가 달라도 되게 소수점은 떼고 읽는다.
private func parseDate(_ s: String?) -> Date? {
  guard let s = s else { return nil }
  let trimmed = s.replacingOccurrences(of: "\\.[0-9]+", with: "", options: .regularExpression)
  return ISO8601DateFormatter().date(from: trimmed)
}

/// 마지막으로 받은 사진 (인터넷이 안 될 때 보여줄 것). 공용 칸에 둔다. owner = 그때의 열쇠 앞 16자리.
private enum Cache {
  private struct Meta: Codable {
    let owner: String
    let snap: Snapshot
  }

  private static var dir: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("widget", isDirectory: true)
  }

  static func save(owner: String, snap: Snapshot, imageData: Data?) {
    guard let dir = dir else { return }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let img = dir.appendingPathComponent("photo.jpg")
    if let data = imageData {
      try? data.write(to: img, options: .atomic)
    } else {
      try? FileManager.default.removeItem(at: img)
    }
    if let meta = try? JSONEncoder().encode(Meta(owner: owner, snap: snap)) {
      try? meta.write(to: dir.appendingPathComponent("meta.json"), options: .atomic)
    }
  }

  static func load(owner: String) -> (Snapshot, UIImage?)? {
    guard let dir = dir,
      let data = try? Data(contentsOf: dir.appendingPathComponent("meta.json")),
      let meta = try? JSONDecoder().decode(Meta.self, from: data),
      meta.owner == owner
    else { return nil }
    let image = (try? Data(contentsOf: dir.appendingPathComponent("photo.jpg"))).flatMap { UIImage(data: $0) }
    return (meta.snap, image)
  }

  static func clear() {
    guard let dir = dir else { return }
    try? FileManager.default.removeItem(at: dir)
  }
}

private enum PushKeys {
  static let token = "widgetPushToken"
  static let env = "widgetPushEnv"
}

/// 애플이 위젯에 '다시 그려' 신호 주소를 주거나 바꿀 때 (iOS 26, 8-2).
/// 주소를 공용 칸에 두고 위젯을 다시 그리게 해서, 다음 확인 때 서버로 보내지게 한다.
@available(iOSApplicationExtension 26.0, *)
struct FamilyPhotoPushHandler: WidgetPushHandler {
  func pushTokenDidChange(_ pushInfo: WidgetPushInfo, widgets: [WidgetInfo]) {
    let defaults = UserDefaults(suiteName: appGroup)
    let hex = pushInfo.token.map { String(format: "%02x", $0) }.joined()
    if widgets.isEmpty || hex.isEmpty {
      // 위젯을 모두 뺐으면 주소를 지운다 (서버에 남은 주소는 애플이 '없음'이라고 하면 서버가 지운다)
      defaults?.removeObject(forKey: PushKeys.token)
      defaults?.removeObject(forKey: PushKeys.env)
      return
    }
    if defaults?.string(forKey: PushKeys.token) == hex { return }
    defaults?.set(hex, forKey: PushKeys.token)
    // 개발 빌드(Debug)는 애플의 시험 서버, 출시 빌드는 실제 서버로 신호가 온다
    #if DEBUG
      defaults?.set("sandbox", forKey: PushKeys.env)
    #else
      defaults?.set("production", forKey: PushKeys.env)
    #endif
    WidgetCenter.shared.reloadAllTimelines()
  }
}

extension WidgetConfiguration {
  /// iOS 26이면 '다시 그려' 신호를 받게 한다. 그보다 오래된 폰은 그대로 (30분 확인만).
  func pushHandlerIfAvailable() -> some WidgetConfiguration {
    if #available(iOSApplicationExtension 26.0, *) {
      return self.pushHandler(FamilyPhotoPushHandler.self)
    } else {
      return self
    }
  }
}

private enum Loader {
  static func load() async -> PhotoEntry {
    let defaults = UserDefaults(suiteName: appGroup)
    guard let key = defaults?.string(forKey: "widgetKey"), !key.isEmpty,
      let endpoint = defaults?.string(forKey: "widgetEndpoint"), let url = URL(string: endpoint)
    else {
      // 로그인 전·로그아웃 뒤: 이전 사람의 사진이 남지 않게 지운다
      Cache.clear()
      return PhotoEntry(date: Date(), snap: Snapshot(state: .connect), image: nil)
    }
    let owner = String(key.prefix(16))

    do {
      var req = URLRequest(url: url, timeoutInterval: 15)
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      var body = ["key": key]
      // 8-2: 신호 주소가 있으면 함께 보낸다 (열쇠가 바뀌어도 다음 확인 때 서버가 새 열쇠로 옮긴다)
      if let token = defaults?.string(forKey: PushKeys.token), !token.isEmpty,
        let env = defaults?.string(forKey: PushKeys.env)
      {
        body["pushToken"] = token
        body["pushEnv"] = env
      }
      req.httpBody = try JSONEncoder().encode(body)
      let (data, resp) = try await URLSession.shared.data(for: req)
      guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
      let feed = try JSONDecoder().decode(FeedResponse.self, from: data)

      switch feed.status {
      case "ok":
        var imageData: Data? = nil
        if let s = feed.imageUrl, let imageURL = URL(string: s) {
          // 썸네일(긴 변 480px)만 받는다. 서명 URL은 5분짜리라 받은 뒤에는 쓰지 않는다
          if let got = try? await URLSession.shared.data(from: imageURL),
            (got.1 as? HTTPURLResponse)?.statusCode == 200, UIImage(data: got.0) != nil
          {
            imageData = got.0
          }
        }
        let snap = Snapshot(
          state: .ok, isNew: feed.isNew ?? false, count: feed.count ?? 0,
          title: feed.title, sender: feed.sender, createdAt: parseDate(feed.createdAt))
        if imageData == nil, let cached = Cache.load(owner: owner), cached.0.createdAt == snap.createdAt {
          // 사진만 못 받았으면 같은 묶음의 저장해 둔 사진을 쓴다
          return PhotoEntry(date: Date(), snap: snap, image: cached.1)
        }
        Cache.save(owner: owner, snap: snap, imageData: imageData)
        return PhotoEntry(date: Date(), snap: snap, image: imageData.flatMap { UIImage(data: $0) })
      case "empty":
        Cache.clear()
        return PhotoEntry(date: Date(), snap: Snapshot(state: .empty), image: nil)
      default:  // invalid · no_group
        Cache.clear()
        return PhotoEntry(date: Date(), snap: Snapshot(state: .connect), image: nil)
      }
    } catch {
      // 인터넷이 안 되거나 서버 오류: 마지막으로 받은 사진을 그대로
      if let cached = Cache.load(owner: owner) {
        return PhotoEntry(date: Date(), snap: cached.0, image: cached.1)
      }
      return PhotoEntry(date: Date(), snap: Snapshot(state: .unavailable), image: nil)
    }
  }
}

// MARK: - 타임라인

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> PhotoEntry {
    PhotoEntry(date: Date(), snap: Snapshot(state: .empty), image: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (PhotoEntry) -> Void) {
    if context.isPreview {
      // 위젯 고르는 화면(미리 보기): 가족 사진을 보여주지 않고 빈 안내만
      completion(placeholder(in: context))
      return
    }
    Task { completion(await Loader.load()) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<PhotoEntry>) -> Void) {
    Task {
      let entry = await Loader.load()
      let minutes = entry.snap.state == .unavailable ? retryMinutes : refreshMinutes
      let next = Date().addingTimeInterval(minutes * 60)
      completion(Timeline(entries: [entry], policy: .after(next)))
    }
  }
}

// MARK: - 날짜 ('오늘'·'어제'·'10월 24일', 한국 시간)

private func dayLabel(_ date: Date?, now: Date) -> String? {
  guard let date = date else { return nil }
  var cal = Calendar(identifier: .gregorian)
  cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
  if cal.isDate(date, inSameDayAs: now) { return Copy.today }
  if let y = cal.date(byAdding: .day, value: -1, to: now), cal.isDate(date, inSameDayAs: y) { return Copy.yesterday }
  let p = cal.dateComponents([.year, .month, .day], from: date)
  let n = cal.component(.year, from: now)
  if p.year == n { return Copy.day(p.month ?? 1, p.day ?? 1) }
  return Copy.dayWithYear(p.year ?? n, p.month ?? 1, p.day ?? 1)
}

private func senderLine(_ snap: Snapshot, now: Date) -> String {
  [snap.sender, dayLabel(snap.createdAt, now: now)].compactMap { $0 }.joined(separator: " · ")
}

// MARK: - iOS 16·17 차이 (iOS 17부터는 위젯 배경을 따로 지정하고, 안쪽 여백이 생긴다)

extension View {
  @ViewBuilder
  func widgetBackground<B: View>(@ViewBuilder _ background: () -> B) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      self.containerBackground(for: .widget, content: background)
    } else {
      self.background(background())
    }
  }

  /// iOS 16에는 시스템 안쪽 여백이 없어 직접 준다
  @ViewBuilder
  func widgetPadding() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      self
    } else {
      self.padding(16)
    }
  }
}

// MARK: - 화면

private struct NewBadge: View {
  let count: Int
  var body: some View {
    Text(Copy.newCount(count))
      .font(.system(size: 18, weight: .bold))
      .foregroundColor(.white)
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
      .background(Capsule().fill(accent))
  }
}

private struct PhotoFill: View {
  let image: UIImage?
  var body: some View {
    GeometryReader { geo in
      if let image = image {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
          .frame(width: geo.size.width, height: geo.size.height)
          .clipped()
      } else {
        Color(red: 0.55, green: 0.55, blue: 0.55)
      }
    }
  }
}

/// 큰 위젯: 사진을 꽉 채우고 위에 '새 사진 N장', 아래에 제목과 'OO이 보냄 · 오늘'
private struct LargeView: View {
  let entry: PhotoEntry
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if entry.snap.isNew && entry.snap.count > 0 {
        NewBadge(count: entry.snap.count)
      }
      Spacer(minLength: 0)
      if let title = entry.snap.title, !title.isEmpty {
        Text(title)
          .font(.system(size: 22, weight: .bold))
          .foregroundColor(.white)
          .lineLimit(2)
      }
      Text(senderLine(entry.snap, now: entry.date))
        .font(.system(size: 18, weight: entry.snap.title?.isEmpty == false ? .regular : .bold))
        .foregroundColor(.white)
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetPadding()
    .widgetBackground {
      ZStack {
        PhotoFill(image: entry.image)
        // 아래쪽 글씨가 사진 위에서도 잘 읽히게 어둡게
        LinearGradient(
          gradient: Gradient(stops: [
            .init(color: .black.opacity(0), location: 0.45),
            .init(color: .black.opacity(0.75), location: 1),
          ]),
          startPoint: .top, endPoint: .bottom)
        LinearGradient(
          gradient: Gradient(stops: [
            .init(color: .black.opacity(0.25), location: 0),
            .init(color: .black.opacity(0), location: 0.25),
          ]),
          startPoint: .top, endPoint: .bottom)
      }
    }
  }
}

/// 중간 위젯: 사진 왼쪽, 글 오른쪽 (홈 화면이 꽉 찬 폰에도 넣기 쉬운 크기)
private struct MediumView: View {
  let entry: PhotoEntry
  var body: some View {
    GeometryReader { geo in
      HStack(spacing: 14) {
        PhotoFill(image: entry.image)
          .frame(width: geo.size.height, height: geo.size.height)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        VStack(alignment: .leading, spacing: 6) {
          if entry.snap.isNew && entry.snap.count > 0 {
            NewBadge(count: entry.snap.count)
          }
          if let title = entry.snap.title, !title.isEmpty {
            Text(title)
              .font(.system(size: 20, weight: .bold))
              .foregroundColor(textColor)
              .lineLimit(2)
          }
          Text(senderLine(entry.snap, now: entry.date))
            .font(.system(size: 18, weight: entry.snap.title?.isEmpty == false ? .regular : .bold))
            .foregroundColor(textColor)
            .lineLimit(2)
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .widgetPadding()
    .widgetBackground { Color.white }
  }
}

/// 사진이 없을 때 (연결 전·가족 사진 없음·처음부터 인터넷이 안 될 때)
private struct MessageView: View {
  let message: String
  var body: some View {
    VStack(spacing: 10) {
      Text(Copy.appName)
        .font(.system(size: 18, weight: .bold))
        .foregroundColor(accent)
      Text(message)
        .font(.system(size: 22, weight: .bold))
        .foregroundColor(textColor)
        .multilineTextAlignment(.center)
        .lineLimit(3)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .widgetPadding()
    .widgetBackground { Color.white }
  }
}

struct FamilyPhotoWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: PhotoEntry

  var body: some View {
    content.widgetURL(openURL)
  }

  @ViewBuilder
  private var content: some View {
    switch entry.snap.state {
    case .ok:
      if family == .systemMedium {
        MediumView(entry: entry)
      } else {
        LargeView(entry: entry)
      }
    case .connect:
      MessageView(message: Copy.connect)
    case .empty:
      MessageView(message: Copy.empty)
    case .unavailable:
      MessageView(message: Copy.unavailable)
    }
  }
}

@main
struct FamilyPhotoWidget: Widget {
  let kind = "FamilyPhotoWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      FamilyPhotoWidgetView(entry: entry)
    }
    .configurationDisplayName(Copy.appName)
    .description(Copy.description)
    .supportedFamilies([.systemMedium, .systemLarge])
    .pushHandlerIfAvailable()
  }
}
