import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get(HealthController);
  });

  it('should return ok status and version', () => {
    const result = controller.getHealth();
    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.1.0');
  });

  it('should return an object with exactly two keys', () => {
    const result = controller.getHealth();
    expect(Object.keys(result)).toEqual(['status', 'version']);
  });

  it('should return consistent results on repeated calls', () => {
    const first = controller.getHealth();
    const second = controller.getHealth();
    expect(first).toEqual(second);
  });

  it('should return version in semver format', () => {
    const result = controller.getHealth();
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
