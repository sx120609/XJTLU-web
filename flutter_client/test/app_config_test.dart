import 'package:flutter_test/flutter_test.dart';

import 'package:cpu_flutter_client/main.dart';

void main() {
  test('bottom navigation mirrors the five current web destinations', () {
    expect(cpuTabs.map((tab) => tab.path), [
      '/home',
      '/market',
      '/square',
      '/services',
      '/profile',
    ]);
  });
}
