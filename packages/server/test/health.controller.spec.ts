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
});
